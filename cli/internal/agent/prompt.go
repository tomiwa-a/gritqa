package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gritqa/cli/internal/model"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
)

// bodyCap bounds one response body. A step returning a list would otherwise
// carry the whole page into the prompt.
const bodyCap = 4000

// confirmCap is tighter because a run of twelve steps sends twelve bodies.
const confirmCap = 2000

const repairSystem = `A step in a test plan failed. Decide whether the test was wrong or the
code was, and say which.

Reply with one JSON object and nothing else:

{
  "conclusion": "test_wrong" | "code_wrong" | "unsure",
  "why": "one sentence a person can act on",
  "step": { the whole corrected step, only when conclusion is test_wrong }
}

Rules:
- test_wrong means the plan asked badly: the wrong payload shape, a field in the
  query that belongs in the body, a stale URL, a wrong extraction path. Return
  the whole step with the fix applied.
- code_wrong means the plan asked correctly and the API answered wrongly. Return
  no step. Say what you expected and why.
- unsure when the response does not tell you. Return no step. Guessing costs a
  real request against a real database.
- You may change request.url, request.headers, request.body, request.query,
  extract[] and an assertion's target.
- You may NOT change an assertion's operator or expected, add or remove an
  assertion, reorder them, or touch id, kind, dependsOn, onFailure or retry.
  Those are claims about what the code should do, and they are the user's to
  make. A fix that touches one is refused and wastes the attempt.
- So a failing status assertion is never test_wrong on its own: there is no
  target to correct. Same for rowCount, exitCode and stdoutContains, which read
  their own channel whatever a target says. If one of those is the only thing
  wrong, that is code_wrong or unsure.
- {{name}} reads a variable an earlier step extracted or the plan seeded. There
  are no functions: {{randomInt 1 9}} would be sent as written. {{runId}} is
  seeded for you and is unique per run.
- Some steps run a statement or a command instead of sending a request. A setup
  statement is repairable: a wrong table or column name in one is exactly
  test_wrong. A verify statement and a shell command are not, because the
  assertions are read against them and a different query is a different claim.
  On those, correct an extraction path or conclude code_wrong or unsure.
- Never suggest editing the API's source. The plan is the only thing you may
  change.`

const confirmSystem = `Every step of a test plan passed. Say whether the run actually proved
what the plan claims.

Reply with one JSON object and nothing else:

{"proved": true, "why": "one sentence", "gaps": ["what was not really tested"]}

A run is not proof when what came back says it went through the motions: a
create that returned no id, a list that came back empty so the filter was never
exercised, an authenticated call that succeeded in a shape suggesting auth was
never checked, a delete followed by no read-back. Look at what the bodies and
the rows actually contain, not just the status codes and the exit codes.

A step that queried the database is the strongest evidence a run has, so its
absence is a gap worth naming: a write confirmed only by the response that
performed it is the code's account of what it did, not a row.

Be specific and be brief. proved true with an empty gaps list is a fine answer
when the bodies really do show the work.`

func repairMessages(req run.RepairRequest) []model.Message {
	var b strings.Builder
	fmt.Fprintf(&b, "Plan: %s\n", req.Plan)
	if req.Attempt > 1 {
		fmt.Fprintf(&b, "This is fix %d — the one before it did not work.\n", req.Attempt)
	}

	b.WriteString("\nThe step, as it ran:\n")
	b.WriteString(indented(req.Step))

	r := req.Result
	b.WriteString("\n" + whatItDid(r) + "\n")
	if r.Err != "" {
		fmt.Fprintf(&b, "The step errored: %s\n", r.Err)
	}
	if r.Kind == plan.ShellStep {
		if out := clip(r.Stdout, bodyCap); out != "" {
			fmt.Fprintf(&b, "\nWhat it printed:\n%s\n", out)
		}
	} else if body := clip(string(r.Body), bodyCap); body != "" {
		fmt.Fprintf(&b, "\nResponse body:\n%s\n", body)
	}

	if failed := failedChecks(r.Checks); len(failed) > 0 {
		b.WriteString("\nWhat failed:\n")
		for _, c := range failed {
			fmt.Fprintf(&b, "- %s %s %s %s, got %s\n",
				c.Type, c.Target, c.Operator, c.Expected, orNothing(c.Actual))
		}
	}

	if req.Handler.Content != "" {
		fmt.Fprintf(&b, "\nThe code serving it, %s:\n%s\n", req.Handler.Path, req.Handler.Content)
	}
	return []model.Message{
		{Role: "system", Content: repairSystem},
		{Role: "user", Content: b.String()},
	}
}

func confirmMessages(req ConfirmRequest) []model.Message {
	var b strings.Builder
	fmt.Fprintf(&b, "Plan: %s\n", req.Plan)
	if req.Description != "" {
		fmt.Fprintf(&b, "It claims to prove: %s\n", req.Description)
	}

	b.WriteString("\nWhat every step did:\n")
	for i, s := range req.Steps {
		fmt.Fprintf(&b, "\n%d. %s — %s\n", i+1, s.Name, whatItDid(s))
		if s.Kind == plan.ShellStep {
			if out := clip(s.Stdout, confirmCap); out != "" {
				fmt.Fprintf(&b, "%s\n", out)
			}
			continue
		}
		if body := clip(string(s.Body), confirmCap); body != "" {
			fmt.Fprintf(&b, "%s\n", body)
		}
	}
	return []model.Message{
		{Role: "system", Content: confirmSystem},
		{Role: "user", Content: b.String()},
	}
}

// whatItDid is one sentence saying what a step actually did, in the terms of the
// kind it was. Both prompts asked "It called %s %s and got %d", which for a sql
// step read "It called   and got 0 in 12ms." -- three blanks and a number that
// meant nothing, in the one place the model has to reason from.
func whatItDid(r run.StepResult) string {
	switch r.Kind {
	case plan.SQLStep:
		// The rows are the finding: a verification query that came back with
		// none is the whole reason this step type exists.
		rows := "rows"
		if r.RowsAffected == 1 {
			rows = "row"
		}
		return fmt.Sprintf("It ran %s and got %d %s in %s.", r.URL, r.RowsAffected, rows, r.Elapsed)
	case plan.ShellStep:
		return fmt.Sprintf("It ran %s and exited %d in %s.", r.URL, r.ExitCode, r.Elapsed)
	}
	return fmt.Sprintf("It called %s %s and got %d in %s.", r.Method, r.URL, r.Code, r.Elapsed)
}

type fixReply struct {
	Conclusion string     `json:"conclusion"`
	Why        string     `json:"why"`
	Step       *plan.Step `json:"step"`
}

// parseFix reads the reply without coercing it. A conclusion of test_wrong with
// no step is downgraded to unsure rather than invented, and the step is
// validated: a fix that will not load must not be sent at a real API.
func parseFix(raw string, before plan.Step) (*run.Fix, error) {
	var in fixReply
	if err := unwrap(raw, &in); err != nil {
		return nil, err
	}

	out := &run.Fix{Why: strings.TrimSpace(in.Why)}
	switch run.RepairKind(strings.TrimSpace(in.Conclusion)) {
	case run.TestWrong:
		out.Kind = run.TestWrong
	case run.CodeWrong:
		out.Kind = run.CodeWrong
		return out, nil
	default:
		out.Kind = run.Unsure
		return out, nil
	}

	if in.Step == nil {
		out.Kind, out.Why = run.Unsure, "it said the test was wrong but sent no fix"
		return out, nil
	}
	// The model may omit fields it did not change; the step it is fixing supplies
	// them, and Allowed then compares like with like.
	step := *in.Step
	if step.ID == "" {
		step.ID = before.ID
	}
	if step.Name == "" {
		step.Name = before.Name
	}
	if step.OnFailure == "" {
		step.OnFailure = before.OnFailure
	}
	if step.Retry == nil {
		step.Retry = before.Retry
	}
	if len(step.DependsOn) == 0 {
		step.DependsOn = before.DependsOn
	}
	if err := plan.ValidateStep(&step); err != nil {
		return nil, err
	}
	out.Step = &step
	return out, nil
}

func parseConfidence(raw string) (*Confidence, error) {
	var out Confidence
	if err := unwrap(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// unwrap reads the one JSON object out of a reply that may carry prose around it.
func unwrap(raw string, into any) error {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return errors.New("the reply had no JSON object in it")
	}
	return json.Unmarshal([]byte(raw[start:end+1]), into)
}

func indented(v any) string {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return ""
	}
	return string(b) + "\n"
}

func failedChecks(checks []run.Check) []run.Check {
	var out []run.Check
	for _, c := range checks {
		if !c.Passed {
			out = append(out, c)
		}
	}
	return out
}

func clip(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n… truncated"
}

func orNothing(s string) string {
	if s == "" {
		return "nothing"
	}
	return s
}

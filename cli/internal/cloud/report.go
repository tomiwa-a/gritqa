package cloud

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
)

// The complete route's own limits. They are duplicated here on purpose: it
// refuses a whole report over one over-long field, and a run whose results were
// thrown away at the door is worse than one reported with a trimmed name.
const (
	maxSteps     = 500
	maxBody      = 64 << 10
	maxID        = 255
	maxMethod    = 10
	maxPattern   = 2048
	maxURL       = 4096
	maxMessage   = 4000
	maxContainer = 64
	maxOutput    = 16000
)

type Report struct {
	InstanceID   string  `json:"instanceId"`
	Outcome      string  `json:"outcome"`
	DurationMs   int64   `json:"durationMs"`
	ContainerID  string  `json:"containerId,omitempty"`
	ErrorMessage string  `json:"errorMessage,omitempty"`
	Steps        []Step  `json:"steps"`
	Moved        []Moved `json:"moved,omitempty"`
	StateNote    string  `json:"stateNote,omitempty"`
}

type Step struct {
	StepID   string `json:"stepId"`
	StepName string `json:"stepName"`
	Status   string `json:"status"`
	// Kind is omitted for an HTTP step, which the route reads as http, so an
	// older CLI reporting into a newer dashboard still says something true.
	Kind           string          `json:"kind,omitempty"`
	Method         string          `json:"method,omitempty"`
	RoutePattern   string          `json:"routePattern,omitempty"`
	RequestURL     string          `json:"requestUrl,omitempty"`
	RequestBody    json.RawMessage `json:"requestBody,omitempty"`
	ResponseStatus int             `json:"responseStatus,omitempty"`
	ResponseBody   json.RawMessage `json:"responseBody,omitempty"`
	ResponseTimeMs int64           `json:"responseTimeMs,omitempty"`
	// RowCount is a sql step's evidence: rows a query came back with, or rows a
	// fixture moved. Carried as a pointer because zero is the interesting answer
	// -- "returned 201, wrote nothing" is the bug this whole step type exists
	// for, and omitempty would drop exactly that.
	RowCount *int64 `json:"rowCount,omitempty"`
	// ExitCode is a shell step's, and zero is the ordinary answer, so it is a
	// pointer for the same reason. It is deliberately not folded into
	// ResponseStatus: an exit code of 0 must never render as HTTP 0.
	ExitCode *int `json:"exitCode,omitempty"`
	// Output is what a shell step printed, already masked by the runner.
	Output       string  `json:"output,omitempty"`
	Assertions   []Check `json:"assertions,omitempty"`
	ErrorMessage string  `json:"errorMessage,omitempty"`
	Moved        []Moved `json:"moved,omitempty"`
}

type Check struct {
	Type     string `json:"type"`
	Operator string `json:"operator"`
	Target   string `json:"target,omitempty"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
	Passed   bool   `json:"passed"`
	Found    bool   `json:"found"`
}

// Moved is one unit that changed, as the ledger records it.
type Moved struct {
	Unit string `json:"unit"`
	Rows int64  `json:"rows"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

// Failed is the report for a job this machine took and could not carry out — a
// sandbox that would not boot, a payload it could not read. The run is settled as
// an error with the reason attached, which is what the dashboard has copy for.
func Failed(instanceID, why string) Report {
	return Report{InstanceID: instanceID, Outcome: "error", ErrorMessage: cut(why, maxMessage)}
}

// Reported turns a finished run into the body the complete route accepts.
//
// The plan comes in beside the result because two of the columns are the plan's
// answer rather than the engine's: routePattern is the URL as written, which is
// what stays comparable across runs, and requestBody is what the plan declared.
func Reported(instanceID string, p *plan.Plan, base string, res *run.Result, container string) Report {
	declared := map[string]plan.Step{}
	if p != nil {
		for _, s := range p.Steps {
			declared[s.ID] = s
		}
	}

	steps := make([]Step, 0, len(res.Steps))
	for i, s := range res.Steps {
		steps = append(steps, step(i, s, declared[s.ID], base))
	}

	outcome := string(res.Status)
	kept, dropped := fit(steps, outcome)

	rep := Report{
		InstanceID:  instanceID,
		Outcome:     outcome,
		DurationMs:  res.Elapsed.Milliseconds(),
		ContainerID: cut(container, maxContainer),
		Steps:       kept,
		Moved:       units(res.Moved),
		StateNote:   cut(res.StateErr, maxMessage),
	}

	var notes []string
	if r := why(steps); r != "" {
		notes = append(notes, r)
	}
	if dropped > 0 {
		notes = append(notes, fmt.Sprintf("this run had %d steps and %d of them are not reported here",
			len(steps), dropped))
	}
	rep.ErrorMessage = cut(strings.Join(notes, " — "), maxMessage)
	return rep
}

// why is the reason a run did not pass, read off the first step that did not. The
// step rows carry the same thing, but they are what fit() may have dropped, and a
// run whose error_message is empty reads on the dashboard as a failure with no
// cause -- which is what sent the user here to ask why.
func why(steps []Step) string {
	first, others := "", 0
	for _, s := range steps {
		r := reason(s)
		if r == "" {
			continue
		}
		if first == "" {
			first = s.StepName + ": " + r
			continue
		}
		others++
	}
	if others > 0 {
		return fmt.Sprintf("%s (and %d more steps did not pass)", first, others)
	}
	return first
}

func reason(s Step) string {
	switch s.Status {
	case string(run.StepError), string(run.StepSkipped):
		return s.ErrorMessage
	case string(run.StepFailed):
		var out []string
		for _, c := range s.Assertions {
			if !c.Passed {
				out = append(out, unmet(c))
			}
		}
		if len(out) == 0 {
			return s.ErrorMessage
		}
		return strings.Join(out, "; ")
	}
	return ""
}

// unmet says what one assertion wanted and what it got. Deliberately the wire's
// own words -- type, operator, expected -- rather than the operator prose the
// terminal prints: that map is presentation and lives with the renderer.
func unmet(c Check) string {
	target := c.Target
	if target == "" {
		target = c.Type
	}
	if c.Operator == string(plan.Exists) {
		return "expected " + target + " to be there, and it was not"
	}
	got := c.Actual
	if got == "" {
		got = "nothing"
	}
	return fmt.Sprintf("expected %s %s %s, got %s", target, c.Operator, c.Expected, got)
}

func step(i int, s run.StepResult, declared plan.Step, base string) Step {
	id := cut(s.ID, maxID)
	if id == "" {
		id = fmt.Sprintf("step-%d", i+1)
	}
	name := cut(s.Name, maxID)
	if name == "" {
		name = id
	}

	out := Step{
		StepID:   id,
		StepName: name,
		Status:   string(s.Status),
		Kind:     kindOf(s),
		Method:   cut(strings.ToUpper(s.Method), maxMethod),
		// RequestURL is the interpolated statement or command for a non-HTTP
		// step, which is the same promise it makes for an HTTP one: what
		// actually went out, replayable.
		RoutePattern:   cut(pattern(declared, s, base), maxPattern),
		RequestURL:     cut(s.URL, maxURL),
		ResponseStatus: s.Code,
		ResponseBody:   payload(s.Body),
		ResponseTimeMs: s.Elapsed.Milliseconds(),
		ErrorMessage:   cut(s.Err, maxMessage),
		Moved:          units(s.Moved),
	}
	switch s.Kind {
	case plan.SQLStep:
		rows := s.RowsAffected
		out.RowCount = &rows
	case plan.ShellStep:
		code := s.ExitCode
		out.ExitCode = &code
		out.Output = cut(s.Stdout, maxOutput)
	}
	if len(declared.Request.Body) > 0 {
		if b, err := json.Marshal(declared.Request.Body); err == nil {
			out.RequestBody = payload(b)
		}
	}
	for _, c := range s.Checks {
		out.Assertions = append(out.Assertions, Check{
			Type: string(c.Type), Operator: string(c.Operator), Target: c.Target,
			Expected: c.Expected, Actual: c.Actual, Passed: c.Passed, Found: c.Found,
		})
	}
	return out
}

// kindOf spells a step's kind for the wire, leaving http empty so the common case
// costs nothing and an older dashboard reads it the way it always has.
func kindOf(s run.StepResult) string {
	if s.IsHTTP() {
		return ""
	}
	return string(s.Kind)
}

// pattern is the URL as the plan wrote it, placeholders and all. The step's own
// URL is the concrete one, so keeping both is what makes "every run that touched
// this route" answerable later.
//
// Empty for a non-HTTP step, and it has to be: route_pattern is what the coverage
// grid counts, and a SQL statement landing in that column would invent an endpoint
// named SELECT. A sql step proving a row was written is evidence about an endpoint
// but it is not traffic to one.
func pattern(declared plan.Step, s run.StepResult, base string) string {
	if !s.IsHTTP() {
		return ""
	}
	if declared.Request.URL != "" {
		return strings.TrimPrefix(declared.Request.URL, strings.TrimRight(base, "/"))
	}
	return strings.TrimPrefix(s.URL, strings.TrimRight(base, "/"))
}

// payload keeps a body renderable as jsonb: parsed when it is JSON, quoted when it
// is not, and replaced by its own size when it is too big to be worth carrying.
// The route does the same swap; doing it here as well keeps the request small.
func payload(b []byte) json.RawMessage {
	if len(b) == 0 {
		return nil
	}
	if len(b) > maxBody {
		return json.RawMessage(fmt.Sprintf(`{"truncated":true,"bytes":%d}`, len(b)))
	}
	if json.Valid(b) {
		return json.RawMessage(b)
	}
	quoted, err := json.Marshal(string(b))
	if err != nil {
		return nil
	}
	return quoted
}

func units(ms []run.Moved) []Moved {
	out := make([]Moved, 0, len(ms))
	for _, m := range ms {
		out = append(out, Moved{Unit: m.Unit, Rows: m.Rows, From: m.From, To: m.To})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// fit trims a report to the route's ceiling. A failed run has to keep a step that
// failed or the route refuses the whole thing for contradicting itself — and the
// step that broke is the one worth keeping anyway.
func fit(steps []Step, outcome string) ([]Step, int) {
	if len(steps) <= maxSteps {
		return steps, 0
	}
	kept := make([]Step, maxSteps)
	copy(kept, steps[:maxSteps])
	dropped := len(steps) - maxSteps

	if outcome != "failed" || broke(kept) {
		return kept, dropped
	}
	for _, s := range steps[maxSteps:] {
		if s.Status == string(run.StepFailed) || s.Status == string(run.StepError) {
			kept[len(kept)-1] = s
			return kept, dropped
		}
	}
	return kept, dropped
}

func broke(steps []Step) bool {
	for _, s := range steps {
		if s.Status == string(run.StepFailed) || s.Status == string(run.StepError) {
			return true
		}
	}
	return false
}

// cut trims to a byte ceiling without leaving half a rune behind: Postgres text
// refuses invalid UTF-8, so a truncated accented message would cost the whole run.
func cut(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}

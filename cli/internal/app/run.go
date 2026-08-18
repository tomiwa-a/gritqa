package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/term"
)

// runPlan executes one plan file and renders the RUN transcript, in the same
// shape read() renders READ.
func runPlan(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options) error {
	p, err := plan.Load(opts.PlanFile)
	if err != nil {
		return err
	}

	base, err := baseURL(w, cfg, p)
	if err != nil {
		return err
	}
	if err := probe(ctx, cfg, base); err != nil {
		return err
	}

	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("running %s against %s — %s",
			p.Name, base, term.Count(len(p.Steps), "step", "steps")),
	})
	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what happened"})

	done := 0
	engine := &run.Engine{
		BaseURL: base,
		OnStep: func(s run.StepResult) {
			done++
			w.Write(term.Line{
				Kind:   term.Tree,
				Text:   s.Name,
				Meta:   stepMeta(s),
				Status: tone(s.Status),
				Last:   done == len(p.Steps),
			})
		},
	}

	started := time.Now()
	res, err := engine.Run(ctx, p)
	if err != nil {
		return err
	}
	record(w, cfg, opts.PlanFile, base, started, res)

	w.Write(term.Line{Kind: term.Blank})
	if res.Status == run.RunPassed {
		w.Write(term.Line{
			Kind: term.OK,
			Text: fmt.Sprintf("all %s passed", term.Count(len(res.Steps), "step", "steps")),
			Meta: term.Dur(res.Elapsed),
		})
		return nil
	}

	w.Write(term.Line{
		Kind: term.Fail,
		Text: fmt.Sprintf("%d of %d steps passed", res.Passed(), len(res.Steps)),
		Meta: term.Dur(res.Elapsed),
	})
	for _, s := range res.Steps {
		for _, r := range reasons(s) {
			w.Write(term.Line{Kind: term.Info, Text: s.Name + ": " + r})
		}
	}
	return nil
}

// record keeps the run in the local cache. A run that happened is worth more
// than a clean exit, so a storage failure is reported and swallowed.
func record(w *term.Writer, cfg *config.Config, file, base string, started time.Time, res *run.Result) {
	store, err := index.Open(cfg.CachePath())
	if err == nil {
		defer store.Close()
		_, err = store.SaveExecution(execution(file, base, started, res))
	}
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "this run was not recorded: " + err.Error()})
	}
}

func execution(file, base string, started time.Time, res *run.Result) *index.Execution {
	e := &index.Execution{
		Plan:      res.Plan,
		PlanFile:  file,
		Status:    string(res.Status),
		Duration:  res.Elapsed,
		StartedAt: started,
		Steps:     make([]index.StepRow, 0, len(res.Steps)),
	}
	for _, s := range res.Steps {
		e.Steps = append(e.Steps, index.StepRow{
			StepID:   s.ID,
			Name:     s.Name,
			Status:   string(s.Status),
			Method:   s.Method,
			Path:     strings.TrimPrefix(s.URL, base),
			Code:     s.Code,
			Duration: s.Elapsed,
			Detail:   strings.Join(reasons(s), "; "),
		})
	}
	return e
}

// baseURL prefers the config, which describes this machine. The plan carries the
// URL it was drafted against, which can name a port that has since moved.
func baseURL(w *term.Writer, cfg *config.Config, p *plan.Plan) (string, error) {
	mine := cfg.Run.ResolvedBaseURL()
	theirs := strings.TrimRight(p.BaseURL, "/")

	switch {
	case mine == "" && theirs == "":
		return "", errors.New("nothing says where your API is — add run.base_url to " +
			config.Dir + "/" + config.Name)
	case mine == "":
		return theirs, nil
	}

	if theirs != "" && theirs != mine {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("the plan was drafted against %s; using %s from your config", theirs, mine),
		})
	}
	return mine, nil
}

// probe checks something is listening before sending twelve steps that would all
// fail with connection refused.
func probe(ctx context.Context, cfg *config.Config, base string) error {
	method, path, configured := cfg.Run.ReadyProbe()
	if !configured {
		method, path = "GET", "/"
	}

	req, err := http.NewRequestWithContext(ctx, method, base+path, nil)
	if err != nil {
		return err
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("nothing is answering at %s — start your API, or point run.base_url "+
			"somewhere that is up", base)
	}
	res.Body.Close()

	if configured && res.StatusCode >= 400 {
		return fmt.Errorf("%s %s answered %s, so your API is up but not ready",
			method, path, res.Status)
	}
	return nil
}

func stepMeta(s run.StepResult) string {
	switch s.Status {
	case run.StepSkipped, run.StepPending:
		return ""
	case run.StepError:
		if s.Code == 0 {
			return ""
		}
	}
	if s.Attempts > 1 {
		return fmt.Sprintf("%d %s, %s", s.Code, term.Count(s.Attempts, "try", "tries"), term.Dur(s.Elapsed))
	}
	return fmt.Sprintf("%d, %s", s.Code, term.Dur(s.Elapsed))
}

func tone(s run.StepStatus) term.Status {
	switch s {
	case run.StepPassed:
		return term.Pass
	case run.StepFailed, run.StepError:
		return term.Failed
	}
	return term.Skip
}

// reasons explains a step that did not pass. The operator wording lives here
// rather than in the engine: it is presentation, the same way plan.ts's map is.
func reasons(s run.StepResult) []string {
	switch s.Status {
	case run.StepError, run.StepSkipped:
		if s.Err == "" {
			return nil
		}
		return []string{s.Err}
	case run.StepFailed:
		var out []string
		for _, c := range s.Checks {
			if !c.Passed {
				out = append(out, describe(c))
			}
		}
		return out
	}
	return nil
}

var operatorWord = map[plan.Operator]string{
	plan.Equals:      "to be",
	plan.NotEquals:   "to be anything but",
	plan.Contains:    "to contain",
	plan.NotContains: "not to contain",
	plan.LT:          "under",
	plan.GT:          "over",
}

func describe(c run.Check) string {
	target := c.Target
	switch c.Type {
	case plan.Status:
		target = "the status"
	case plan.ResponseTime:
		target = "the response time"
	case plan.HeaderField:
		target = "the " + c.Target + " header"
	}

	if c.Operator == plan.Exists {
		return "expected " + target + " to be there, and it was not"
	}
	if !c.Found {
		return fmt.Sprintf("expected %s %s %s, and the response has no %s",
			target, operatorWord[c.Operator], c.Expected, target)
	}
	return fmt.Sprintf("expected %s %s %s, got %s",
		target, operatorWord[c.Operator], c.Expected, orNothing(c.Actual))
}

func orNothing(s string) string {
	if s == "" {
		return "nothing"
	}
	return s
}

// Package run executes a test plan against a running API. A green run costs
// nothing but HTTP: no model is involved unless something fails.
package run

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

type ExecutionStatus string

const (
	RunPassed  ExecutionStatus = "passed"
	RunFailed  ExecutionStatus = "failed"
	RunErrored ExecutionStatus = "error"
)

type Engine struct {
	// BaseURL prefixes every relative step URL. It describes this machine, so it
	// wins over whatever the plan was drafted against.
	BaseURL string
	HTTP    *http.Client
	// OnStep is called as each step settles, so a transcript can stream.
	OnStep func(StepResult)
}

type Result struct {
	Plan    string
	Status  ExecutionStatus
	Steps   []StepResult
	Vars    map[string]string
	Elapsed time.Duration
}

// RunID is seeded before every run and is different each time. A plan that signs
// a new user up needs its email to be unique or the second run fails on a row
// the first one left behind, and the plan format has no functions — so the
// engine supplies the one value that cannot be written down.
const RunID = "runId"

func runID() string {
	return strconv.FormatInt(time.Now().UnixNano()/int64(time.Millisecond), 36)
}

func (e *Engine) client() *http.Client {
	if e.HTTP != nil {
		return e.HTTP
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// Run walks the plan in dependency order. A step whose dependency did not pass
// is skipped rather than sent, because its variables were never bound; a failed
// abort step leaves everything after it pending.
func (e *Engine) Run(ctx context.Context, p *plan.Plan) (*Result, error) {
	order, err := p.Order()
	if err != nil {
		return nil, err
	}

	vars := make(map[string]string, len(p.Variables)+1)
	vars[RunID] = runID()
	for k, v := range p.Variables {
		vars[k] = v
	}

	started := time.Now()
	out := &Result{Plan: p.Name, Steps: make([]StepResult, 0, len(order)), Vars: vars}
	settled := make(map[string]StepStatus, len(order))
	aborted := false

	for _, s := range order {
		var r StepResult
		switch {
		case aborted:
			r = shell(s, StepPending, "")
		case blocker(s, settled) != "":
			r = shell(s, StepSkipped, fmt.Sprintf(
				"%s did not pass, so this had nothing to run with", blocker(s, settled)))
		default:
			r = e.step(ctx, s, vars)
		}

		settled[s.ID] = r.Status
		out.Steps = append(out.Steps, r)
		if e.OnStep != nil {
			e.OnStep(r)
		}
		if s.OnFailure == plan.Abort && (r.Status == StepFailed || r.Status == StepError) {
			aborted = true
		}
		if ctx.Err() != nil {
			aborted = true
		}
	}

	out.Elapsed = time.Since(started)
	out.Status = statusOf(out.Steps)
	return out, nil
}

func (r *Result) Passed() int {
	n := 0
	for _, s := range r.Steps {
		if s.Status == StepPassed {
			n++
		}
	}
	return n
}

// statusOf reads the run the way a person would: a failed assertion is a
// finding, a broken harness is not. Only when nothing failed does an error
// become the headline.
func statusOf(steps []StepResult) ExecutionStatus {
	failed, errored := false, false
	for _, s := range steps {
		switch s.Status {
		case StepFailed:
			failed = true
		case StepError:
			errored = true
		}
	}
	switch {
	case failed:
		return RunFailed
	case errored:
		return RunErrored
	}
	return RunPassed
}

func blocker(s plan.Step, settled map[string]StepStatus) string {
	for _, dep := range s.DependsOn {
		if settled[dep] != StepPassed {
			return dep
		}
	}
	return ""
}

func shell(s plan.Step, status StepStatus, why string) StepResult {
	return StepResult{
		ID:     s.ID,
		Name:   s.Label(),
		Method: s.Request.Method,
		URL:    s.Request.URL,
		Status: status,
		Err:    why,
	}
}

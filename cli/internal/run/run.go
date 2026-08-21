// Package run executes a test plan against a running API. A green run costs
// nothing but HTTP: no model is involved unless something fails.
package run

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
	// OnStep is called once per step, after repair has settled, so a transcript
	// streams without a re-run corrupting its arithmetic.
	OnStep func(StepResult)
	// Variables are seeded before the walk and win over the plan's own, because
	// the config describes this machine the same way BaseURL does. This is where
	// a credential enters a run: the plan only ever names it.
	Variables map[string]string
	// Secrets are values that must not survive into a reported URL. A password
	// interpolated into a query string would otherwise reach the recorded run and
	// the repairer's prompt, which is the leak run.variables exists to prevent.
	Secrets []string

	// Repairer is optional. With none, a failed step settles exactly as it did
	// before M3 and the run costs nothing but HTTP.
	Repairer Repairer
	// OnRepair narrates each repair attempt, accepted or declined.
	OnRepair func(Attempt)
	// Handler resolves a step to the source that serves it, when the index knows.
	Handler func(plan.Step) Handler
	// Attempts bounds fixes per failed step; Budget bounds them for the whole run.
	Attempts int
	Budget   int

	// State is optional, exactly as Repairer is. With none, a run takes no
	// readings and reports what it reported before M4.
	State State

	// SandboxDB is the *sql.DB for the throwaway database. SQL steps use it
	// directly; with nil, a SQL step is an error.
	SandboxDB *sql.DB
	// SandboxName is the container name, for shell steps that run docker exec.
	SandboxName string
	// ShellExec runs a command in the sandbox container and returns stdout and
	// the exit code. With nil, a shell step is an error.
	ShellExec func(ctx context.Context, command string) (stdout string, exitCode int, err error)

	plan     string
	spent    int
	masks    []string
	stateErr string
}

type Result struct {
	Plan    string
	Status  ExecutionStatus
	Steps   []StepResult
	Vars    map[string]string
	Elapsed time.Duration
	// Repairs is how many model calls the run spent fixing steps.
	Repairs int
	// Moved is the whole run's ledger: what the world looks like after, against
	// what it looked like before the first step.
	Moved []Moved
	// StateErr is why a reading failed, when one did. It never changes Status:
	// the HTTP result stands on its own and the delta is annotation.
	StateErr string
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

	vars := make(map[string]string, len(p.Variables)+len(e.Variables)+1)
	vars[RunID] = runID()
	for k, v := range p.Variables {
		vars[k] = v
	}
	for k, v := range e.Variables {
		vars[k] = v
	}

	e.plan, e.spent, e.stateErr = p.Name, 0, ""

	started := time.Now()
	before := e.mark(ctx)
	last := before
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
			if e.Repairer != nil && (r.Status == StepFailed || r.Status == StepError) {
				r = e.repair(ctx, s, r, vars)
			}
			// After repair settles, so the delta covers the attempt that stuck
			// rather than the one that failed.
			if e.State != nil && writes(s) {
				if now := e.mark(ctx); now != nil {
					r.Moved, last = diff(last, now), now
				}
			}
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
	out.Repairs = e.spent
	out.Status = statusOf(out.Steps)
	out.Moved = diff(before, e.mark(ctx))
	out.StateErr = e.stateErr
	return out, nil
}

// writes is true for a method that can change something. SQL and shell steps
// always write. A read-only plan takes no readings at all, which keeps a green
// GET run at the cost of its HTTP.
func writes(s plan.Step) bool {
	if s.Kind == plan.SQLStep || s.Kind == plan.ShellStep {
		return true
	}
	switch strings.ToUpper(s.Request.Method) {
	case "", "GET", "HEAD", "OPTIONS":
		return false
	}
	return true
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

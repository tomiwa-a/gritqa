package run

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

// RepairKind is what the model concluded about a failed step.
type RepairKind string

const (
	TestWrong RepairKind = "test_wrong"
	CodeWrong RepairKind = "code_wrong"
	Unsure    RepairKind = "unsure"
)

// Repairer decides whether a failed step was the test's fault. It may rewrite
// the request; it may never change what the step asserts, and it never edits the
// user's source.
type Repairer interface {
	Repair(ctx context.Context, req RepairRequest) (*Fix, error)
}

type RepairRequest struct {
	Plan string
	Step plan.Step
	// Result is the failed attempt: the status it got, the body, and the checks.
	Result StepResult
	// Handler is the source serving the endpoint the step called, when the index
	// knows which file that is. A miss is fine — the response body repairs most
	// drafting mistakes on its own.
	Handler Handler
	// Attempt is 1 on the first ask, so a second one knows its last fix failed.
	Attempt int
}

type Handler struct {
	Path    string
	Content string
}

// Fix is the model's answer. Step is set only when Kind is TestWrong.
type Fix struct {
	Kind RepairKind
	Why  string
	Step *plan.Step
}

// Attempt is one repair as it settled: what was concluded, whether the edit was
// allowed, and what the re-run did. The transcript and history both read it.
type Attempt struct {
	StepID string
	N      int
	Kind   RepairKind
	Why    string
	Before plan.Step
	// After is the step as the model wrote it, set even when it was refused —
	// a repairer reaching for a frozen field is worth seeing.
	After *plan.Step
	// Refused is why Allowed said no. Empty when the edit was applied.
	Refused string
	// Status is the re-run's outcome, empty when nothing was re-run.
	Status StepStatus
	// Err is the repairer itself failing, or the budget being spent.
	Err string
}

func (a Attempt) Accepted() bool { return a.After != nil && a.Refused == "" }

// Allowed is the whole honesty guarantee, as one reviewable function. Repair may
// correct how a step asks; it may not touch what the step claims. A repairer
// free to move expected onto whatever came back makes every run green and the
// product a liar, so operator, expected and the set of assertions are frozen —
// which is what keeps a 500 a finding rather than a fix.
func Allowed(before, after plan.Step) error {
	switch {
	case after.ID != before.ID:
		return fmt.Errorf("it renamed the step to %q", after.ID)
	case !reflect.DeepEqual(names(after.DependsOn), names(before.DependsOn)):
		return errChanged("dependsOn")
	case after.OnFailure != before.OnFailure:
		return errChanged("onFailure")
	case !reflect.DeepEqual(after.Retry, before.Retry):
		return errChanged("retry")
	case kindOf(after) != kindOf(before):
		return errChanged("kind")
	}
	if err := allowedAction(before, after); err != nil {
		return err
	}

	if len(after.Assertions) != len(before.Assertions) {
		return fmt.Errorf("it went from %d assertions to %d — repair may correct how a step "+
			"asks, never what it claims", len(before.Assertions), len(after.Assertions))
	}
	for i, a := range after.Assertions {
		b := before.Assertions[i]
		switch {
		case a.Type != b.Type:
			return fmt.Errorf("assertion %d changed type from %s to %s", i+1, b.Type, a.Type)
		case a.Operator != b.Operator:
			return fmt.Errorf("assertion %d changed the operator from %s to %s — that is a claim "+
				"about what the code should do, and yours to make", i+1, b.Operator, a.Operator)
		case !sameValue(a.Expected, b.Expected):
			return fmt.Errorf("assertion %d moved expected from %v to %v — that is a claim about "+
				"what the code should do, and yours to make", i+1, b.Expected, a.Expected)
		}
	}
	return nil
}

// allowedAction freezes what a step runs when its assertions are read against
// that rather than against a response. rowCount 1 over a rewritten query is a
// different claim, and exitCode 0 from a rewritten command proves nothing that was
// asked for, so both are frozen for the reason expected is. A setup statement is
// the means and not the claim — a repair that breaks one fails the steps that
// needed the state, not this one — so a mistyped column there is still fixable, and
// so is an extraction path on any kind.
func allowedAction(before, after plan.Step) error {
	a, b := after.Action, before.Action
	if a == nil && b == nil {
		return nil
	}
	if a == nil || b == nil {
		return errChanged("what the step runs")
	}
	if a.Target != b.Target {
		return errChanged("target")
	}
	if b.Target != plan.Verify && kindOf(before) != plan.ShellStep {
		return nil
	}
	if a.Statement != b.Statement || a.Command != b.Command {
		return errors.New("it rewrote what the step runs, and the assertions are read against " +
			"that — a different query or command is a different claim, and yours to make")
	}
	return nil
}

func errChanged(field string) error {
	return fmt.Errorf("it changed %s, which restructures the plan rather than fixing the step", field)
}

// names treats nil and empty as the same list, since JSON round-trips one into
// the other.
func names(s []string) []string {
	if len(s) == 0 {
		return nil
	}
	return s
}

// sameValue compares as the plan means it: 200 read back from JSON is a float64,
// and a model echoing it may write an int.
func sameValue(a, b any) bool {
	if reflect.DeepEqual(a, b) {
		return true
	}
	return normalise(a) == normalise(b)
}

// repair asks whether a failed step was the test's fault, and re-runs it when the
// answer is an edit it is allowed to make. Dependents have not run yet, so a
// repaired step needs no replay: everything downstream sees the fix naturally.
func (e *Engine) repair(ctx context.Context, s plan.Step, r StepResult, vars map[string]string) StepResult {
	for n := 1; n <= e.attempts(); n++ {
		if e.spent >= e.budget() {
			e.note(Attempt{StepID: s.ID, N: n, Before: s, Err: fmt.Sprintf(
				"the repair budget for this run is spent, so %s was left as it is", s.Label())})
			return r
		}
		e.spent++

		fix, err := e.Repairer.Repair(ctx, RepairRequest{
			Plan:    e.plan,
			Step:    s,
			Result:  r,
			Handler: e.handler(s),
			Attempt: n,
		})
		if err != nil {
			e.note(Attempt{StepID: s.ID, N: n, Before: s, Err: err.Error()})
			return r
		}

		a := Attempt{StepID: s.ID, N: n, Kind: fix.Kind, Why: fix.Why, Before: s}
		if fix.Kind != TestWrong || fix.Step == nil {
			e.note(a)
			return r
		}

		a.After = fix.Step
		if why := Allowed(s, *fix.Step); why != nil {
			// Not retried as a fix: a repairer reaching for a frozen field would
			// reach for it again, and the attempt is worth recording as declined.
			a.Refused = why.Error()
			e.note(a)
			return r
		}

		s = *fix.Step
		r = e.step(ctx, s, vars)
		a.Status = r.Status
		e.note(a)
		if r.Status == StepPassed {
			return r
		}
	}
	return r
}

func (e *Engine) note(a Attempt) {
	if e.OnRepair != nil {
		e.OnRepair(a)
	}
}

// handler finds the source serving this step's endpoint, when the caller wired a
// lookup. It is best-effort by design: query-string routing misses often.
func (e *Engine) handler(s plan.Step) Handler {
	if e.Handler == nil {
		return Handler{}
	}
	return e.Handler(s)
}

func (e *Engine) attempts() int {
	if e.Attempts > 0 {
		return e.Attempts
	}
	return 2
}

func (e *Engine) budget() int {
	if e.Budget > 0 {
		return e.Budget
	}
	return 8
}

package run

import "context"

// State observes what a step changed. Optional in exactly the way Repairer is:
// with none, a run reports what it reported before M4 and costs nothing but HTTP.
//
// The engine cannot tell whether a passing POST actually wrote anything, and a
// green run that touched nothing is the failure mode this closes.
type State interface {
	Mark(ctx context.Context) (Mark, error)
}

// Mark is one reading of the world. Diff is on the reading rather than on State
// so the engine never has to hold both and decide which way round they go.
type Mark interface {
	// Diff reports what moved between an earlier reading and this one. A nil
	// before means there is nothing to compare against.
	Diff(before Mark) []Moved
}

// Moved is one unit that changed. Rows is signed, because a delete moving a
// count down is as much a finding as an insert moving it up.
type Moved struct {
	Unit string
	Rows int64
	// From and To are the high-water mark either side, empty for a unit that can
	// only be counted.
	From string
	To   string
}

// mark takes a reading, or nil when there is no State or it failed. A watermark
// that cannot be read is not a reason to fail a run: the HTTP result stands on
// its own, and the delta is annotation.
func (e *Engine) mark(ctx context.Context) Mark {
	if e.State == nil {
		return nil
	}
	m, err := e.State.Mark(ctx)
	if err != nil {
		e.stateErr = err.Error()
		return nil
	}
	return m
}

func diff(before, after Mark) []Moved {
	if before == nil || after == nil {
		return nil
	}
	return after.Diff(before)
}

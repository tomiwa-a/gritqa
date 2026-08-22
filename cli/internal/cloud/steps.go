package cloud

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
)

// Steps as they finish, so a plan that takes half a minute is not a blank panel for
// half a minute.
//
//	POST /api/cli/jobs/{id}/steps
//	{ "instanceId": "...", "steps": [ <the shape a completion sends> ] }
//	-> 200 { "ok": true, "steps": n }
//
// A preview and only that. The completion rewrites every step it covers, so nothing
// sent here is the last word on one — which is what makes dropping a step under load
// the right trade rather than a lost result.
type Live struct {
	c        *Client
	job      string
	instance string
	base     string
	plan     *plan.Plan

	queue chan pending
	done  chan struct{}
	once  sync.Once
	lost  atomic.Bool
}

type pending struct {
	i int
	s run.StepResult
}

// Enough for any plan a person wrote. Past it steps are dropped, which is the point:
// the walk's pace is the product.
const liveQueue = 64

// Live starts reporting one job's steps. Nil when there is nothing to report to, and
// every method tolerates that, so a caller with no cloud behind it changes nothing.
func (c *Client) Live(ctx context.Context, job, instanceID, base string, p *plan.Plan) *Live {
	if c == nil {
		return nil
	}
	l := &Live{
		c: c, job: job, instance: instanceID, base: base, plan: p,
		queue: make(chan pending, liveQueue),
		done:  make(chan struct{}),
	}
	go l.pump(ctx)
	return l
}

// Send queues a finished step. Dropped rather than blocked when the queue is full,
// and never called after Close.
func (l *Live) Send(i int, s run.StepResult) {
	if l == nil {
		return
	}
	select {
	case l.queue <- pending{i, s}:
	default:
	}
}

// Close stops reporting and waits for what is already queued.
//
// It has to happen before the completion goes out. The route replaces a step by its
// id and cannot tell which of two writes is the newer one, so a preview still in
// flight would land on top of the record.
func (l *Live) Close() {
	if l == nil {
		return
	}
	l.once.Do(func() { close(l.queue) })
	<-l.done
}

// pump sends in the order the steps finished, which is the order they are worth
// reading in. One at a time for the same reason.
func (l *Live) pump(ctx context.Context) {
	defer close(l.done)
	for {
		select {
		case <-ctx.Done():
			return
		case p, ok := <-l.queue:
			if !ok {
				return
			}
			if l.lost.Load() {
				continue
			}
			// A job this machine no longer owns will refuse every step after this
			// one too, so stop asking. The walk finds out for itself when it
			// reports.
			if err := l.send(ctx, p.i, p.s); errors.Is(err, ErrLostJob) {
				l.lost.Store(true)
			}
		}
	}
}

type stepsPush struct {
	InstanceID string `json:"instanceId"`
	Steps      []Step `json:"steps"`
}

func (l *Live) send(ctx context.Context, i int, s run.StepResult) error {
	path := jobPath(l.job, "steps")
	r, err := l.c.call(ctx, http.MethodPost, path, stepsPush{
		InstanceID: l.instance,
		Steps:      []Step{step(i, s, l.declared(s.ID), l.base)},
	})
	if err != nil {
		return err
	}
	switch {
	case r.ok():
		return nil
	case r.Status == http.StatusNotFound:
		return ErrLostJob
	}
	return l.c.fail(path, r)
}

// declared is the step as the plan wrote it, which is where routePattern and the
// declared body come from. A scan rather than a map: plans are handfuls of steps and
// a map here would be a second copy of one.
func (l *Live) declared(id string) plan.Step {
	if l.plan == nil {
		return plan.Step{}
	}
	for _, s := range l.plan.Steps {
		if s.ID == id {
			return s
		}
	}
	return plan.Step{}
}

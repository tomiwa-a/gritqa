package cloud

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// A run nobody queued.
//
//	POST /api/cli/executions   Authorization: Bearer <cli token>
//	{ "planId": "...", "startedAt": "2026-08-25T09:14:02Z", <every field of a Report> }
//	-> 200 { "ok": true, "run": "...", "steps": 6 }
//	   404 unknown_plan
//
// jobs/[id]/complete settles a run the dashboard asked for; this records one it
// never knew about -- a developer typing gritqa --run on their own machine. Same
// report, same validation on the far side, so the two cannot disagree about what a
// step may look like.
//
// The plan has to be up first: test_executions.test_plan_id is NOT NULL, so a run
// of a file that never became a plan has nowhere to hang. That is what ErrNoPlan
// says, and the answer to it is PushPlan and then this again.
const executionsPath = "/api/cli/executions"

// ErrNoPlan is the 404: this server holds no plan by that id, so there is nothing
// for the run to be a run of.
var ErrNoPlan = errors.New("the dashboard has no plan by that id")

// Recorded is the run as the dashboard filed it.
type Recorded struct {
	Run   string `json:"run"`
	Steps int    `json:"steps"`
}

// runPush is a report with the two things a queued one does not need to say. The
// job route knows the plan from the job and the start from the claim; nothing here
// claimed anything, so both are stated.
type runPush struct {
	Report
	PlanID    string `json:"planId"`
	StartedAt string `json:"startedAt,omitempty"`
}

// PushExecution files a finished run. startedAt may be the zero time, which the
// route reads as "not said" rather than as the epoch.
func (c *Client) PushExecution(ctx context.Context, planID string, startedAt time.Time, report Report) (*Recorded, error) {
	push := runPush{Report: report, PlanID: planID}
	if !startedAt.IsZero() {
		push.StartedAt = startedAt.UTC().Format(time.RFC3339)
	}

	r, err := c.call(ctx, http.MethodPost, executionsPath, push)
	if err != nil {
		return nil, err
	}
	if r.Status == http.StatusNotFound {
		return nil, ErrNoPlan
	}
	if !r.ok() {
		return nil, c.fail(executionsPath, r)
	}
	out := &Recorded{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"
)

// Job types, as the queue names them.
const (
	JobExecute = "execute_tests"
	JobIndex   = "index_codebase"
)

// Identity is who is polling. The instance id is the only required part, because
// without it the dashboard has no row to move; the rest decorates the machine.
type Identity struct {
	InstanceID string `json:"instanceId"`
	Hostname   string `json:"hostname,omitempty"`
	Version    string `json:"version,omitempty"`
}

type Job struct {
	PublicID    string          `json:"publicId"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	Attempt     int             `json:"attempt"`
	MaxAttempts int             `json:"maxAttempts"`
}

// Claimed is the poll's whole answer. A nil Job means the queue was empty, which
// is a successful answer to the question and not an absence of one.
type Claimed struct {
	Job         *Job `json:"job"`
	Reaped      int  `json:"reaped"`
	PollAfterMs int  `json:"pollAfterMs"`
}

// PollAfter is how long to wait before asking again. Clamped, because the interval
// comes off the wire and a zero would spin.
func (c *Claimed) PollAfter() time.Duration {
	const fallback = 2 * time.Second
	if c == nil || c.PollAfterMs <= 0 {
		return fallback
	}
	d := time.Duration(c.PollAfterMs) * time.Millisecond
	if d < 500*time.Millisecond {
		return 500 * time.Millisecond
	}
	if d > time.Minute {
		return time.Minute
	}
	return d
}

// RunPayload is what an execute_tests job carries. Plan is left raw so plan.Load's
// own types unmarshal it: the plan format is the wire format between brain and
// hands, and re-describing it here would be a second copy to keep in step.
type RunPayload struct {
	ExecutionPublicID string          `json:"executionPublicId"`
	PlanPublicID      string          `json:"planPublicId"`
	PlanName          string          `json:"planName"`
	PlanVersion       int             `json:"planVersion"`
	BaseURL           string          `json:"baseUrl"`
	Plan              json.RawMessage `json:"plan"`
}

// Claim records that this machine is alive and asks for one job.
func (c *Client) Claim(ctx context.Context, id Identity) (*Claimed, error) {
	const path = "/api/cli/jobs/claim"
	r, err := c.call(ctx, http.MethodPost, path, id)
	if err != nil {
		return nil, err
	}
	if !r.ok() {
		return nil, c.fail(path, r)
	}
	out := &Claimed{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

// Heartbeat says the job is still being worked on. Every reply other than success
// means this machine no longer owns it.
func (c *Client) Heartbeat(ctx context.Context, job, instanceID string) error {
	path := jobPath(job, "heartbeat")
	r, err := c.call(ctx, http.MethodPost, path, struct {
		InstanceID string `json:"instanceId"`
	}{instanceID})
	if err != nil {
		return err
	}
	switch {
	case r.ok():
		return nil
	case r.Status == http.StatusNotFound:
		return ErrLostJob
	}
	return c.fail(path, r)
}

// Completed is the receipt: the run these results became, and how many steps
// landed.
type Completed struct {
	Run   string `json:"run"`
	Steps int    `json:"steps"`
}

// Complete hands the results back. This is the end of the round trip, and it is
// the only call whose body the server can refuse on content — see Reported, which
// builds one the route will take.
func (c *Client) Complete(ctx context.Context, job string, report Report) (*Completed, error) {
	path := jobPath(job, "complete")
	r, err := c.call(ctx, http.MethodPost, path, report)
	if err != nil {
		return nil, err
	}
	switch {
	case r.ok():
		out := &Completed{}
		if err := r.into(out); err != nil {
			return nil, err
		}
		return out, nil
	case r.Status == http.StatusNotFound:
		return nil, ErrLostJob
	}
	return nil, c.fail(path, r)
}

// Release gives a job back. For delivery going wrong — this machine cannot do
// this one — never for a test that failed, which is a job that succeeded.
// The answer is "requeued" or "dead".
func (c *Client) Release(ctx context.Context, job, instanceID, reason string) (string, error) {
	path := jobPath(job, "release")
	r, err := c.call(ctx, http.MethodPost, path, struct {
		InstanceID string `json:"instanceId"`
		Reason     string `json:"reason,omitempty"`
	}{instanceID, reason})
	if err != nil {
		return "", err
	}
	switch {
	case r.ok():
		var out struct {
			Outcome string `json:"outcome"`
		}
		if err := r.into(&out); err != nil {
			return "", err
		}
		return out.Outcome, nil
	case r.Status == http.StatusNotFound:
		return "", ErrLostJob
	}
	return "", c.fail(path, r)
}

func jobPath(job, verb string) string {
	return "/api/cli/jobs/" + url.PathEscape(job) + "/" + verb
}

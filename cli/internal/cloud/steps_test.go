package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
)

// desk is the dashboard's half of the preview: it records every push in arrival order
// and can be told to start refusing.
type desk struct {
	mu     sync.Mutex
	pushes []stepsPush
	gone   bool
	block  chan struct{}
}

func (d *desk) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if d.block != nil {
			<-d.block
		}
		var body stepsPush
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.mu.Lock()
		gone := d.gone
		if !gone {
			d.pushes = append(d.pushes, body)
		}
		d.mu.Unlock()
		if gone {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "steps": 1})
	})
}

func (d *desk) seen() []stepsPush {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]stepsPush(nil), d.pushes...)
}

func (d *desk) lose() {
	d.mu.Lock()
	d.gone = true
	d.mu.Unlock()
}

func liveDesk(t *testing.T, d *desk, p *plan.Plan) *Live {
	t.Helper()
	ts := httptest.NewServer(d.handler())
	t.Cleanup(ts.Close)
	c := &Client{Server: ts.URL, Token: "t", HTTP: ts.Client()}
	return c.Live(context.Background(), "job-1", "inst-1", "http://app.test", p)
}

// Order is the whole value of a preview: steps arrive as they finish, and the panel is
// worth reading in that order.
func TestLiveSendsInOrderAndDrainsOnClose(t *testing.T) {
	d := &desk{}
	p := &plan.Plan{Steps: []plan.Step{
		{ID: "a", Request: plan.Request{URL: "http://app.test/rooms"}},
		{ID: "b"},
	}}
	l := liveDesk(t, d, p)

	l.Send(0, run.StepResult{ID: "a", Name: "list rooms", Kind: plan.HTTPStep,
		Method: "get", URL: "http://app.test/rooms", Status: run.StepPassed, Code: 200})
	l.Send(1, run.StepResult{ID: "b", Name: "book one", Kind: plan.HTTPStep,
		Status: run.StepFailed, Code: 500, Err: "boom"})
	l.Close()
	l.Close() // idempotent: attach defers one and calls one

	got := d.seen()
	if len(got) != 2 {
		t.Fatalf("pushed %d times, want 2", len(got))
	}
	for i, want := range []string{"a", "b"} {
		if len(got[i].Steps) != 1 {
			t.Fatalf("push %d carried %d steps, want 1", i, len(got[i].Steps))
		}
		if got[i].Steps[0].StepID != want {
			t.Errorf("push %d was step %q, want %q", i, got[i].Steps[0].StepID, want)
		}
		if got[i].InstanceID != "inst-1" {
			t.Errorf("push %d named instance %q", i, got[i].InstanceID)
		}
	}
	// The plan's URL, not the walked one: routePattern is what the coverage grid
	// counts, and it has to be the template.
	if got[0].Steps[0].RoutePattern != "/rooms" {
		t.Errorf("routePattern %q, want /rooms", got[0].Steps[0].RoutePattern)
	}
	if got[0].Steps[0].Method != "GET" {
		t.Errorf("method %q, want GET", got[0].Steps[0].Method)
	}
}

// A step with no name and no id still has to report as something: the two columns are
// NOT NULL, so the route refuses a blank one.
func TestLiveNamesAnUnnamedStep(t *testing.T) {
	d := &desk{}
	l := liveDesk(t, d, nil)
	l.Send(4, run.StepResult{Status: run.StepPassed})
	l.Close()

	got := d.seen()
	if len(got) != 1 {
		t.Fatalf("pushed %d times, want 1", len(got))
	}
	if got[0].Steps[0].StepID != "step-5" || got[0].Steps[0].StepName != "step-5" {
		t.Errorf("reported %q/%q, want step-5 twice",
			got[0].Steps[0].StepID, got[0].Steps[0].StepName)
	}
}

// A 404 means the job is somebody else's now, and every step after it would get the
// same answer. Stop asking rather than spend the rest of the walk on refusals.
func TestLiveStopsAfterTheJobIsLost(t *testing.T) {
	d := &desk{}
	l := liveDesk(t, d, nil)

	d.lose()
	l.Send(0, run.StepResult{ID: "a", Status: run.StepPassed})
	// Serial pump, so by the time the second push could land the first has been
	// answered. Close drains, which is what makes this deterministic.
	l.Close()

	if got := d.seen(); len(got) != 0 {
		t.Fatalf("recorded %d pushes after losing the job", len(got))
	}
	// Nothing to assert on the wire once it has stopped, so assert the state that
	// stopped it.
	if !l.lost.Load() {
		t.Error("the pump did not notice the job was gone")
	}
}

// The walk's pace is the product, so a queue that has filled drops rather than blocks.
// Never Close, because Close waits for the drain the block is holding.
func TestLiveDropsRatherThanBlocksTheWalk(t *testing.T) {
	d := &desk{block: make(chan struct{})}
	l := liveDesk(t, d, nil)
	defer close(d.block)

	for i := 0; i < liveQueue*4; i++ {
		l.Send(i, run.StepResult{ID: "a", Status: run.StepPassed})
	}
	// Reaching here at all is the assertion: a blocking Send would still be in the
	// loop, holding up a run that has work to do.
}

// A nil Live is the no-cloud path, and every method has to tolerate it or `--plan`
// stops working.
func TestNilLiveIsInert(t *testing.T) {
	var c *Client
	l := c.Live(context.Background(), "job", "inst", "", nil)
	if l != nil {
		t.Fatal("a nil client handed back a Live")
	}
	l.Send(0, run.StepResult{})
	l.Close()
}

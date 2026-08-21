package cloud

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
)

func TestReportedKeepsThePlansURL(t *testing.T) {
	p := &plan.Plan{Name: "p", Steps: []plan.Step{{
		ID:      "one",
		Request: plan.Request{Method: "POST", URL: "/rooms/{{roomId}}", Body: map[string]any{"n": 1}},
	}}}
	res := &run.Result{Plan: "p", Status: run.RunPassed, Elapsed: time.Second, Steps: []run.StepResult{{
		ID: "one", Name: "book", Method: "POST", URL: "http://x/rooms/7",
		Status: run.StepPassed, Code: 201, Body: []byte(`{"id":7}`),
	}}}

	rep := Reported("machine", p, "http://x", res, "abc")
	if len(rep.Steps) != 1 {
		t.Fatalf("steps = %d, want 1", len(rep.Steps))
	}
	s := rep.Steps[0]
	if s.RoutePattern != "/rooms/{{roomId}}" {
		t.Fatalf("routePattern = %q, want the URL as the plan wrote it", s.RoutePattern)
	}
	if s.RequestURL != "http://x/rooms/7" {
		t.Fatalf("requestUrl = %q, want the one that was sent", s.RequestURL)
	}
	if string(s.RequestBody) != `{"n":1}` {
		t.Fatalf("requestBody = %s", s.RequestBody)
	}
	if string(s.ResponseBody) != `{"id":7}` {
		t.Fatalf("responseBody = %s", s.ResponseBody)
	}
}

// The route refuses a failed run with no failing step, so trimming to its ceiling
// has to keep one.
func TestFitKeepsAFailingStep(t *testing.T) {
	steps := make([]Step, 0, maxSteps+2)
	for i := 0; i < maxSteps+1; i++ {
		steps = append(steps, Step{StepID: "ok", Status: string(run.StepPassed)})
	}
	steps = append(steps, Step{StepID: "broke", Status: string(run.StepFailed)})

	kept, dropped := fit(steps, "failed")
	if len(kept) != maxSteps || dropped != 2 {
		t.Fatalf("kept %d, dropped %d", len(kept), dropped)
	}
	if !broke(kept) {
		t.Fatal("a failed run was reported with nothing that failed, which the route refuses")
	}
}

func TestPayloadQuotesWhatIsNotJSON(t *testing.T) {
	got := payload([]byte("<html>no</html>"))
	var s string
	if err := json.Unmarshal(got, &s); err != nil {
		t.Fatalf("a non-JSON body was not renderable as jsonb: %s", got)
	}
	if payload(make([]byte, maxBody+1)) == nil {
		t.Fatal("an oversized body should report its size, not vanish")
	}
}

func TestCutKeepsValidUTF8(t *testing.T) {
	got := cut(strings.Repeat("é", 20), 5)
	if len(got) != 4 {
		t.Fatalf("cut left %d bytes, want a whole number of runes", len(got))
	}
}

// All three of symbols, dependencies and endpoints are NOT NULL jsonb, so a nil
// there is a refused request rather than a defaulted one.
func TestMirrorNeverSendsNull(t *testing.T) {
	snap := &index.Snapshot{
		Files:  []index.File{{Path: "api/rooms.php", Language: "php", Hash: "abc"}},
		Routes: []routes.Route{{Method: "GET", Path: "/rooms", File: "api/rooms.php"}},
	}
	b, err := json.Marshal(Mirror("machine", snap))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "null") {
		t.Fatalf("the push carries a null: %s", b)
	}
}

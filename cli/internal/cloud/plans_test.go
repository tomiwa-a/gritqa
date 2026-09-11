package cloud

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

// The trap this whole file exists for. plan.Step carries Request by value with no
// omitempty, so a sql step marshalled straight off the plan says
// `"request": {"method": "", "url": ""}` -- and the route reads method against a
// list of five verbs, which makes every mixed plan a 400 rather than a plan.
func TestASQLStepSendsNoRequest(t *testing.T) {
	p := &plan.Plan{Name: "p", BaseURL: "http://x", Steps: []plan.Step{{
		ID:     "seed",
		Kind:   plan.SQLStep,
		Action: &plan.Action{Statement: "INSERT INTO guests (email) VALUES ('a@b.c')", Target: plan.Setup},
	}}}

	b, err := json.Marshal(Drafted("machine", "", p, ""))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Steps []map[string]json.RawMessage `json:"steps"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if _, has := got.Steps[0]["request"]; has {
		t.Fatalf("a sql step sent a request: %s", b)
	}
	if _, has := got.Steps[0]["action"]; !has {
		t.Fatalf("a sql step sent no action: %s", b)
	}
}

// Four things the runner tolerates and the route does not: an unspelled onFailure,
// an assertion with no target, and dependsOn/extract/assertions as null.
func TestDraftedSpellsOutWhatTheRunnerDefaults(t *testing.T) {
	p := &plan.Plan{Name: "p", BaseURL: "http://x", Steps: []plan.Step{{
		ID:      "one",
		Request: plan.Request{Method: "get", URL: "/rooms"},
		Assertions: []plan.Assertion{
			{Type: plan.Status, Operator: plan.Equals, Expected: 200},
		},
	}}}

	step := Drafted("machine", "", p, "").Steps[0]
	if step.OnFailure != string(plan.Abort) {
		t.Fatalf("onFailure = %q, want abort spelled out", step.OnFailure)
	}
	if step.Assertions[0].Target != string(plan.Status) {
		t.Fatalf("target = %q, want the assertion's own name", step.Assertions[0].Target)
	}
	if step.Name != "one" {
		t.Fatalf("name = %q, want the id standing in", step.Name)
	}
	if step.Request == nil || step.Request.Method != "GET" {
		t.Fatalf("method = %+v, want GET", step.Request)
	}
	// http is the kind every plan written before the other two is made of, so it
	// stays unspelled and the route reads an absent kind as http.
	if step.Kind != "" {
		t.Fatalf("kind = %q, want http left unsaid", step.Kind)
	}

	b, _ := json.Marshal(step)
	for _, field := range []string{`"dependsOn":[]`, `"extract":[]`} {
		if !strings.Contains(string(b), field) {
			t.Fatalf("want %s in %s", field, b)
		}
	}
}

// covers is what the coverage grid reads, and it comes off the steps: a route
// pattern the dashboard can group by, not the URL that was sent.
func TestCoveredIsRoutePatternsAndKnownVerbs(t *testing.T) {
	p := &plan.Plan{Name: "p", BaseURL: "http://x", Steps: []plan.Step{
		{ID: "a", Request: plan.Request{Method: "GET", URL: "/rooms/{{roomId}}?full=1"}},
		{ID: "b", Request: plan.Request{Method: "HEAD", URL: "/rooms"}},
		{ID: "c", Kind: plan.ShellStep, Action: &plan.Action{Command: "true"}},
	}}

	got := Drafted("machine", "", p, "").Covers
	if len(got) != 1 {
		t.Fatalf("covers = %+v, want one row", got)
	}
	if got[0].Method != "GET" || got[0].Path != "/rooms/:id" {
		t.Fatalf("covers = %+v, want GET /rooms/:id", got[0])
	}
}

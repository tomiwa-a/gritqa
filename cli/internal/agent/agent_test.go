package agent

import (
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
)

func before() plan.Step {
	return plan.Step{
		ID:        "s1",
		Name:      "create an order",
		DependsOn: []string{"s0"},
		Request: plan.Request{
			Method:  "POST",
			URL:     "/orders",
			Headers: map[string]string{"Authorization": "Bearer {{authToken}}"},
			Body:    map[string]any{"guest_id": "{{guestId}}"},
			Query:   map[string]string{},
		},
		Extract: []plan.Extraction{{Name: "orderId", Path: "$.data.id", Source: plan.FromBody}},
		Assertions: []plan.Assertion{
			{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(201)},
			{Type: plan.BodyField, Operator: plan.Exists, Target: "data.id"},
		},
		OnFailure: plan.Abort,
		Retry:     &plan.Retry{MaxAttempts: 2, DelayMs: 250},
	}
}

// The model sends the step it changed, not the whole one. What it left out has to
// come back from the step being fixed, or Allowed reads an omission as an edit.
func TestParseFixFillsInWhatTheModelOmitted(t *testing.T) {
	fix, err := parseFix(`{"conclusion":"test_wrong","why":"guest_id is a query param",
		"step":{"id":"s1","request":{"method":"POST","url":"/orders","query":{"guest_id":"{{guestId}}"}},
		"assertions":[
			{"type":"status","operator":"equals","target":"status","expected":201},
			{"type":"bodyField","operator":"exists","target":"data.id"}]}}`, before())
	if err != nil {
		t.Fatal(err)
	}
	if fix.Kind != run.TestWrong || fix.Step == nil {
		t.Fatalf("%+v", fix)
	}
	if err := run.Allowed(before(), *fix.Step); err != nil {
		t.Fatalf("a fix that only moved a param must be allowed: %v", err)
	}
	if fix.Step.Name != "create an order" || fix.Step.Retry == nil {
		t.Errorf("the omitted fields did not come back: %+v", fix.Step)
	}
}

func TestParseFixDowngradesAFixWithNoStep(t *testing.T) {
	fix, err := parseFix(`{"conclusion":"test_wrong","why":"the payload is wrong"}`, before())
	if err != nil {
		t.Fatal(err)
	}
	if fix.Kind != run.Unsure || !strings.Contains(fix.Why, "no fix") {
		t.Fatalf("%+v", fix)
	}
}

func TestParseFixReadsTheOtherTwoConclusions(t *testing.T) {
	for raw, want := range map[string]run.RepairKind{
		`{"conclusion":"code_wrong","why":"it dereferences a null discount"}`: run.CodeWrong,
		`{"conclusion":"unsure","why":"the body says nothing"}`:               run.Unsure,
		`{"conclusion":"something else","why":"?"}`:                           run.Unsure,
	} {
		fix, err := parseFix(raw, before())
		if err != nil {
			t.Fatal(err)
		}
		if fix.Kind != want {
			t.Errorf("%s → %s, want %s", raw, fix.Kind, want)
		}
	}
}

// A fix that would not have loaded from disk must not be sent at a real API.
func TestParseFixRejectsAStepThatWouldNotValidate(t *testing.T) {
	if _, err := parseFix(`{"conclusion":"test_wrong","why":"try a fresh id",
		"step":{"id":"s1","request":{"method":"POST","url":"/orders/{{orderId Updated}}"}}}`,
		before()); err == nil {
		t.Fatal("{{orderId Updated}} is not a variable reference and has to be refused")
	}
}

func TestConfidenceParses(t *testing.T) {
	c, err := parseConfidence(`Here you go: {"proved":false,"why":"auth was never checked",
		"gaps":["no step sent a bad token"]}`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Proved || len(c.Gaps) != 1 {
		t.Fatalf("%+v", c)
	}
}

func TestChangesNamesWhatMoved(t *testing.T) {
	after := before()
	after.Request.URL = "/orders?guest_id={{guestId}}"
	after.Request.Body = nil
	after.Request.Headers["X-Trace"] = "1"
	after.Extract[0].Path = "$.data.order.id"
	after.Assertions[1].Target = "data.order.id"

	got := Changes(before(), after)
	if len(got) == 0 {
		t.Fatal("an edited step has to produce rows")
	}

	var details []string
	for _, c := range got {
		if c.Kind != valueChanged {
			t.Errorf("repair can only ever change a value, got %s", c.Kind)
		}
		if c.Step != "create an order" {
			t.Errorf("every row names its step, got %q", c.Step)
		}
		details = append(details, c.Detail)
	}

	joined := strings.Join(details, " | ")
	for _, want := range []string{"url", "body", "X-Trace", "orderId", "data.id"} {
		if !strings.Contains(joined, want) {
			t.Errorf("no row mentions %s: %s", want, joined)
		}
	}
}

// A refused repair still produces rows: what the model reached for is the point.
func TestChangesRecordsARefusedAssertionEdit(t *testing.T) {
	after := before()
	after.Assertions = after.Assertions[:1]

	got := Changes(before(), after)
	var kinds []string
	for _, c := range got {
		kinds = append(kinds, c.Kind)
	}
	if !strings.Contains(strings.Join(kinds, " "), assertionRemoved) {
		t.Fatalf("kinds = %v, want a removal recorded", kinds)
	}
}

// The same repair recorded twice has to produce the same rows, or a diff of two
// runs is noise.
func TestChangesAreStable(t *testing.T) {
	after := before()
	after.Request.Headers = map[string]string{"A": "1", "B": "2", "C": "3"}

	first, second := Changes(before(), after), Changes(before(), after)
	if len(first) != len(second) {
		t.Fatalf("%d rows then %d", len(first), len(second))
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("row %d moved: %+v vs %+v", i, first[i], second[i])
		}
	}
}

package draft

import (
	"strings"
	"testing"
)

const minimal = `{"name":"Tax on a mixed cart","description":"d","steps":[
	{"id":"s1","request":{"method":"GET","url":"/checkout"},
	 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}]}`

// A model that says "Here is the plan:" first is not a model that failed.
func TestParseUnwrapsProse(t *testing.T) {
	p, err := Parse("Sure — here is the plan:\n```json\n" + minimal + "\n```\nHope that helps.")
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Tax on a mixed cart" {
		t.Fatalf("name = %q", p.Name)
	}
}

// Nothing is coerced: a plan that will not validate is reported, because a
// half-understood plan runs the wrong requests against a real API.
func TestParseRefusesWhatItCannotRun(t *testing.T) {
	for _, raw := range []string{
		"I would rather not.",
		`{"name":"p"}`,
		`{"name":"p","steps":[{"id":"s1","request":{"method":"YEET","url":"/x"}}]}`,
	} {
		if _, err := Parse(raw); err == nil {
			t.Errorf("%q should not have parsed", raw)
		}
	}
}

func TestFinishFillsWhatTheModelDoesNotDecide(t *testing.T) {
	p, err := Parse(minimal)
	if err != nil {
		t.Fatal(err)
	}
	got := finish(p, Request{BaseURL: "http://localhost:9000"})

	if got.Version != 1 {
		t.Errorf("version = %d, want 1", got.Version)
	}
	if got.BaseURL != "http://localhost:9000" {
		t.Errorf("baseUrl = %q, want this machine's", got.BaseURL)
	}
}

// The brief is the whole contract with the model: the files that changed, the
// endpoints they register, and the plans the project already has.
func TestBriefCarriesTheRequest(t *testing.T) {
	body := brief(Request{
		Project: "shop-api",
		BaseURL: "http://localhost:8080",
		Files: []File{{
			Path:     "handlers/tax.go",
			Language: "go",
			Content:  "func ApplyTax(w http.ResponseWriter, r *http.Request) {}",
		}},
		Endpoints: []Endpoint{{
			Signature: "POST /checkout/:id/tax",
			File:      "handlers/tax.go",
			Handler:   "ApplyTax",
			NeedsAuth: true,
		}},
		Existing: []Existing{{
			Name:      "Partial refund skips shipped lines",
			Endpoints: []string{"POST /refunds"},
		}},
	})

	for _, want := range []string{
		"shop-api",
		"http://localhost:8080",
		"POST /checkout/:id/tax",
		"ApplyTax",
		"handlers/tax.go",
		"func ApplyTax",
		"Partial refund skips shipped lines",
		"POST /refunds",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the brief never mentions %q", want)
		}
	}
	if !strings.Contains(strings.ToLower(body), "auth") {
		t.Error("a guarded endpoint has to say so, or the plan skips signing in")
	}
}

// The rules the plan is drafted under are not optional wording.
func TestSystemPromptHoldsTheRules(t *testing.T) {
	msgs := messages(Request{Project: "p"})
	if len(msgs) != 2 || msgs[0].Role != "system" || msgs[1].Role != "user" {
		t.Fatalf("got %d messages: %+v", len(msgs), msgs)
	}
	low := strings.ToLower(msgs[0].Content)
	for _, want := range []string{"sql", "{{", "$.", "abort", "continue"} {
		if !strings.Contains(low, want) {
			t.Errorf("the system prompt never mentions %q", want)
		}
	}
}

// The user's own words, and their title for the plan.
func TestBriefCarriesABrief(t *testing.T) {
	body := brief(Request{
		Project: "hotel-api",
		BaseURL: "http://localhost/hotel/api/",
		Brief:   "Book a room, then try to double-book the same dates.",
		Name:    "No double bookings",
		Cover:   []string{"POST /index.php?controller=reservation&action=create"},
	})

	for _, want := range []string{
		"Call the plan: No double bookings",
		"Book a room, then try to double-book the same dates.",
		"Cover exactly these endpoints:\n- POST /index.php?controller=reservation&action=create",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the brief does not carry %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "Write the plan for:") {
		t.Error("a described plan has no focus file")
	}
}

// The user named it, so the user's name wins over the model's.
func TestFinishKeepsTheNameTheUserGave(t *testing.T) {
	p, err := Parse(minimal)
	if err != nil {
		t.Fatal(err)
	}
	if got := finish(p, Request{Name: "No double bookings"}); got.Name != "No double bookings" {
		t.Errorf("name = %q", got.Name)
	}
}

package run

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

func step(id string) plan.Step {
	return plan.Step{
		ID:        id,
		Name:      "a step",
		DependsOn: []string{},
		Request: plan.Request{
			Method:  "POST",
			URL:     "/orders",
			Headers: map[string]string{"Authorization": "Bearer t"},
			Body:    map[string]any{"guest_id": "g_1"},
			Query:   map[string]string{},
		},
		Extract: []plan.Extraction{{Name: "orderId", Path: "$.data.id", Source: plan.FromBody}},
		Assertions: []plan.Assertion{
			{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(201)},
			{Type: plan.BodyField, Operator: plan.Exists, Target: "data.id"},
		},
		OnFailure: plan.Abort,
	}
}

// Decision 15, every row of it. What a step asks may move; what it claims may not.
func TestAllowed(t *testing.T) {
	cases := []struct {
		what string
		edit func(*plan.Step)
		ok   bool
	}{
		{"the url", func(s *plan.Step) { s.Request.URL = "/orders?guest_id=g_1" }, true},
		{"a header", func(s *plan.Step) { s.Request.Headers["X-Trace"] = "1" }, true},
		{"the body", func(s *plan.Step) { s.Request.Body = map[string]any{"guestId": "g_1"} }, true},
		{"the query", func(s *plan.Step) { s.Request.Query["guest_id"] = "g_1" }, true},
		{"the method", func(s *plan.Step) { s.Request.Method = "PUT" }, true},
		{"an extraction path", func(s *plan.Step) { s.Extract[0].Path = "$.data.order.id" }, true},
		{"an assertion target", func(s *plan.Step) { s.Assertions[1].Target = "data.order.id" }, true},

		{"the id", func(s *plan.Step) { s.ID = "s99" }, false},
		{"dependsOn", func(s *plan.Step) { s.DependsOn = []string{"s0"} }, false},
		{"onFailure", func(s *plan.Step) { s.OnFailure = plan.Continue }, false},
		{"retry", func(s *plan.Step) { s.Retry = &plan.Retry{MaxAttempts: 9} }, false},
		{"a widened expected", func(s *plan.Step) { s.Assertions[0].Expected = float64(500) }, false},
		{"a flipped operator", func(s *plan.Step) { s.Assertions[0].Operator = plan.NotEquals }, false},
		{"an assertion type", func(s *plan.Step) { s.Assertions[0].Type = plan.ResponseTime }, false},
		{"a deleted assertion", func(s *plan.Step) { s.Assertions = s.Assertions[:1] }, false},
		{"an added assertion", func(s *plan.Step) {
			s.Assertions = append(s.Assertions, plan.Assertion{
				Type: plan.BodyField, Operator: plan.Exists, Target: "data.total"})
		}, false},
	}

	for _, c := range cases {
		after := step("s1")
		c.edit(&after)
		err := Allowed(step("s1"), after)
		if c.ok && err != nil {
			t.Errorf("%s should be allowed: %v", c.what, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%s should have been refused", c.what)
		}
	}
}

// 200 as an int and 200 as JSON's float64 are the same claim.
func TestAllowedIgnoresHowANumberWasSpelt(t *testing.T) {
	after := step("s1")
	after.Assertions[0].Expected = 201
	if err := Allowed(step("s1"), after); err != nil {
		t.Fatalf("201 and 201.0 are the same expectation: %v", err)
	}
}

func sqlStep(target plan.Target) plan.Step {
	return plan.Step{
		ID: "q1", Name: "the booking landed", DependsOn: []string{},
		Kind: plan.SQLStep,
		Action: &plan.Action{
			Statement: "SELECT count(*) AS n FROM bookings WHERE guest_id = '{{guestId}}'",
			Target:    target,
		},
		Extract:    []plan.Extraction{{Name: "n", Path: "row.n", Source: plan.FromResult}},
		Assertions: []plan.Assertion{{Type: plan.RowCount, Operator: plan.Equals, Target: "rowCount", Expected: float64(1)}},
		OnFailure:  plan.Abort,
	}
}

func shellStep() plan.Step {
	return plan.Step{
		ID: "c1", Name: "the queue drained", DependsOn: []string{},
		Kind:       plan.ShellStep,
		Action:     &plan.Action{Command: "php artisan queue:work --once"},
		Assertions: []plan.Assertion{{Type: plan.ExitCode, Operator: plan.Equals, Target: "exitCode", Expected: float64(0)}},
		OnFailure:  plan.Abort,
	}
}

// The same guarantee, for the kinds whose evidence is not a response. Freezing
// expected is worth nothing on a verify step if the query it is read against can be
// rewritten: WHERE 1=1 satisfies rowCount 1 without proving the booking exists, and
// `true` exits 0 without running anything. A setup statement is the other case — it
// is how the plan builds state, and a repair that breaks one fails the steps that
// needed it rather than passing this one.
func TestAllowedFreezesTheEvidenceANonHTTPStepIsGradedOn(t *testing.T) {
	cases := []struct {
		what   string
		before plan.Step
		edit   func(*plan.Step)
		ok     bool
	}{
		{"a verify extraction path", sqlStep(plan.Verify),
			func(s *plan.Step) { s.Extract[0].Path = "rows[0].n" }, true},
		{"a mistyped column in a setup statement", sqlStep(plan.Setup),
			func(s *plan.Step) { s.Action.Statement = "INSERT INTO bookings (guest_id) VALUES ('g_1')" }, true},

		{"a rewritten verify statement", sqlStep(plan.Verify),
			func(s *plan.Step) { s.Action.Statement = "SELECT 1 AS n" }, false},
		{"a verify turned into a setup", sqlStep(plan.Verify),
			func(s *plan.Step) { s.Action.Target = plan.Setup }, false},
		{"a rewritten command", shellStep(),
			func(s *plan.Step) { s.Action.Command = "true" }, false},
		{"a dropped action", shellStep(),
			func(s *plan.Step) { s.Action = nil }, false},
		{"a sql step turned into a request", sqlStep(plan.Verify),
			func(s *plan.Step) { s.Kind = plan.HTTPStep }, false},
		{"a request turned into a shell step", step("s1"),
			func(s *plan.Step) {
				s.Kind = plan.ShellStep
				s.Action = &plan.Action{Command: "true"}
			}, false},
	}

	for _, c := range cases {
		after := c.before
		// The action is a pointer, so the copy shares it until the edit gets its own.
		if c.before.Action != nil {
			a := *c.before.Action
			after.Action = &a
		}
		after.Extract = append([]plan.Extraction(nil), c.before.Extract...)
		c.edit(&after)
		err := Allowed(c.before, after)
		if c.ok && err != nil {
			t.Errorf("%s should be allowed: %v", c.what, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%s should have been refused", c.what)
		}
	}
}

// A plan written before there was more than one kind carries no kind at all, so the
// absent one and "http" have to read as the same step or every fix to an old plan is
// refused as a restructuring.
func TestAllowedTreatsAnAbsentKindAsHTTP(t *testing.T) {
	after := step("s1")
	after.Kind = plan.HTTPStep
	if err := Allowed(step("s1"), after); err != nil {
		t.Fatalf("an absent kind and http are the same step: %v", err)
	}
}

// scripted answers one fix per call, in order.
type scripted struct {
	fixes []*Fix
	err   error
	seen  []RepairRequest
}

func (s *scripted) Repair(_ context.Context, req RepairRequest) (*Fix, error) {
	s.seen = append(s.seen, req)
	if s.err != nil {
		return nil, s.err
	}
	if len(s.fixes) == 0 {
		return &Fix{Kind: Unsure, Why: "nothing left to try"}, nil
	}
	f := s.fixes[0]
	s.fixes = s.fixes[1:]
	return f, nil
}

// The whole point: a fixed request re-runs in place, and the dependent step sees
// the variable it extracted without any replay.
func TestRepairReRunsTheStepAndDependentsFollow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/orders" {
			if r.URL.Query().Get("guest_id") == "" {
				w.WriteHeader(422)
				w.Write([]byte(`{"message":"guest_id is required"}`))
				return
			}
			w.WriteHeader(201)
		}
		w.Write([]byte(`{"data":{"id":"o_1"}}`))
	}))
	defer srv.Close()

	fixed := step("s1")
	fixed.Request.Query = map[string]string{"guest_id": "g_1"}

	p := &plan.Plan{Name: "orders", Steps: []plan.Step{step("s1"), {
		ID:        "s2",
		DependsOn: []string{"s1"},
		Request:   plan.Request{Method: "GET", URL: "/orders/{{orderId}}"},
		Assertions: []plan.Assertion{
			{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(200)},
		},
	}}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	var seen []Attempt
	fake := &scripted{fixes: []*Fix{{Kind: TestWrong, Why: "guest_id is a query param", Step: &fixed}}}
	e := &Engine{
		BaseURL:  srv.URL,
		Repairer: fake,
		OnRepair: func(a Attempt) { seen = append(seen, a) },
	}

	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("%s — %s", res.Status, statuses(res))
	}
	if res.Repairs != 1 {
		t.Errorf("Repairs = %d, want 1", res.Repairs)
	}
	if len(seen) != 1 || !seen[0].Accepted() || seen[0].Status != StepPassed {
		t.Fatalf("attempts = %+v", seen)
	}
	if len(fake.seen) != 1 || !strings.Contains(string(fake.seen[0].Result.Body), "guest_id") {
		t.Error("the repairer has to see the body that failed")
	}
	if res.Vars["orderId"] != "o_1" {
		t.Errorf("the repaired step's extraction did not land: %v", res.Vars)
	}
}

// OnStep fires once per step however many times repair re-ran it, or the
// transcript's tree arithmetic is wrong.
func TestRepairDoesNotDoubleCountSteps(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(422)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	fixed := step("s1")
	fixed.Request.URL = "/orders?x=1"

	p := &plan.Plan{Name: "orders", Steps: []plan.Step{step("s1")}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	steps := 0
	e := &Engine{
		BaseURL:  srv.URL,
		Repairer: &scripted{fixes: []*Fix{{Kind: TestWrong, Why: "try a query", Step: &fixed}}},
		OnStep:   func(StepResult) { steps++ },
	}
	if _, err := e.Run(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if steps != 1 {
		t.Fatalf("OnStep fired %d times for 1 step", steps)
	}
}

// A repairer reaching for a frozen field is recorded as declined, not retried.
func TestRepairRefusesAFrozenEditAndStops(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	cheat := step("s1")
	cheat.Assertions[0].Expected = float64(500)

	p := &plan.Plan{Name: "orders", Steps: []plan.Step{step("s1")}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	var seen []Attempt
	e := &Engine{
		BaseURL:  srv.URL,
		Repairer: &scripted{fixes: []*Fix{{Kind: TestWrong, Why: "it returns 500", Step: &cheat}}},
		OnRepair: func(a Attempt) { seen = append(seen, a) },
	}

	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunFailed {
		t.Fatalf("a refused repair must leave the run failed, got %s", res.Status)
	}
	if len(seen) != 1 {
		t.Fatalf("%d attempts, want the declined one and no retry", len(seen))
	}
	if seen[0].Accepted() || seen[0].Refused == "" || seen[0].After == nil {
		t.Errorf("a declined attempt keeps what was tried: %+v", seen[0])
	}
}

// The budget is the run's, not the step's: many failing steps share it.
func TestRepairBudgetHoldsAcrossSteps(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	var steps []plan.Step
	for _, id := range []string{"s1", "s2", "s3", "s4"} {
		s := step(id)
		s.OnFailure = plan.Continue
		steps = append(steps, s)
	}
	p := &plan.Plan{Name: "orders", Steps: steps}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	fake := &scripted{}
	var spent, skipped int
	e := &Engine{
		BaseURL: srv.URL, Repairer: fake, Attempts: 2, Budget: 3,
		OnRepair: func(a Attempt) {
			if strings.Contains(a.Err, "budget") {
				skipped++
			}
		},
	}

	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	spent = len(fake.seen)
	if spent != 3 {
		t.Fatalf("%d model calls, want the budget's 3", spent)
	}
	if res.Repairs != 3 {
		t.Errorf("Repairs = %d, want 3", res.Repairs)
	}
	if skipped == 0 {
		t.Error("a run that ran out of budget has to say so rather than stop quietly")
	}
}

// A repairer that is down is not a reason to lose the failure it was asked about.
func TestRepairerFailureIsRecordedNotFatal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	p := &plan.Plan{Name: "orders", Steps: []plan.Step{step("s1")}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	var seen []Attempt
	e := &Engine{
		BaseURL:  srv.URL,
		Repairer: &scripted{err: errors.New("the model timed out")},
		OnRepair: func(a Attempt) { seen = append(seen, a) },
	}

	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunFailed || len(seen) != 1 || seen[0].Err == "" {
		t.Fatalf("status %s, attempts %+v", res.Status, seen)
	}
}

// With no repairer a failed run costs nothing but HTTP, which is the promise the
// deterministic engine exists to keep.
func TestNoRepairerIsUnchanged(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	p := &plan.Plan{Name: "orders", Steps: []plan.Step{step("s1")}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	res, err := (&Engine{BaseURL: srv.URL}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunFailed || res.Repairs != 0 {
		t.Fatalf("%s, %d repairs", res.Status, res.Repairs)
	}
}

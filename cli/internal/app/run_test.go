package app

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

func writer() (*term.Writer, *bytes.Buffer) {
	var buf bytes.Buffer
	return term.New(&buf).Plain(), &buf
}

func conf(t *testing.T, r *config.Run) *config.Config {
	t.Helper()
	c := config.New(t.TempDir(), "main")
	c.Run = r
	return c
}

// The config describes this machine; the plan carries the URL it was drafted
// against, which can name a port that has since moved.
func TestBaseURLPrefersTheConfig(t *testing.T) {
	w, out := writer()

	got, err := baseURL(w, conf(t, &config.Run{BaseURL: "http://localhost:9000"}),
		&plan.Plan{BaseURL: "http://localhost:8080"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://localhost:9000" {
		t.Fatalf("got %q", got)
	}
	for _, want := range []string{"8080", "9000"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("the disagreement was not reported: %q", out)
		}
	}
}

func TestBaseURLFallsBackToThePlan(t *testing.T) {
	w, out := writer()

	got, err := baseURL(w, conf(t, nil), &plan.Plan{BaseURL: "http://localhost:8080/"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://localhost:8080" {
		t.Fatalf("got %q, want no trailing slash", got)
	}
	if out.Len() != 0 {
		t.Errorf("nothing disagreed, so nothing to say: %q", out)
	}
}

func TestBaseURLWithNothingSaysWhatToAdd(t *testing.T) {
	w, _ := writer()

	_, err := baseURL(w, conf(t, nil), &plan.Plan{})
	if err == nil || !strings.Contains(err.Error(), "run.base_url") {
		t.Fatalf("err = %v", err)
	}
}

// Twelve steps all failing with connection refused explains nothing; one line
// about the API being down explains everything.
func TestProbeSaysWhenNothingIsListening(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	base := srv.URL
	srv.Close()

	err := probe(context.Background(), conf(t, &config.Run{BaseURL: base}), base)
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"nothing is answering", base, "run.base_url"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

// With no ready probe configured, anything answering at all is enough — a 404 on
// / is normal for an API.
func TestProbeAcceptsAnyAnswerWhenUnconfigured(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(404)
	}))
	defer srv.Close()

	if err := probe(context.Background(), conf(t, &config.Run{}), srv.URL); err != nil {
		t.Fatal(err)
	}
}

func TestProbeReportsAConfiguredReadyFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(503)
		}
	}))
	defer srv.Close()

	err := probe(context.Background(), conf(t, &config.Run{Ready: "GET /health"}), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "up but not ready") {
		t.Fatalf("err = %v", err)
	}
}

func TestDescribeReadsLikeASentence(t *testing.T) {
	cases := []struct {
		check run.Check
		want  string
	}{
		{
			run.Check{Type: plan.Status, Operator: plan.Equals, Expected: "200", Actual: "401", Found: true},
			"expected the status to be 200, got 401",
		},
		{
			run.Check{Type: plan.BodyField, Operator: plan.Equals, Target: "data.tax_total",
				Expected: "66750", Actual: "61200", Found: true},
			"expected data.tax_total to be 66750, got 61200",
		},
		{
			run.Check{Type: plan.BodyField, Operator: plan.Equals, Target: "data.tax_total", Expected: "66750"},
			"expected data.tax_total to be 66750, and the response has no data.tax_total",
		},
		{
			run.Check{Type: plan.BodyField, Operator: plan.Exists, Target: "data.token"},
			"expected data.token to be there, and it was not",
		},
		{
			run.Check{Type: plan.ResponseTime, Operator: plan.LT, Expected: "2000", Actual: "3100", Found: true},
			"expected the response time under 2000, got 3100",
		},
		{
			run.Check{Type: plan.HeaderField, Operator: plan.Contains, Target: "content-type",
				Expected: "json", Actual: "text/html", Found: true},
			"expected the content-type header to contain json, got text/html",
		},
		{
			run.Check{Type: plan.BodyField, Operator: plan.Equals, Target: "data.status",
				Expected: "open", Actual: "", Found: true},
			"expected data.status to be open, got nothing",
		},
	}

	for _, c := range cases {
		if got := describe(c.check); got != c.want {
			t.Errorf("got  %q\nwant %q", got, c.want)
		}
	}
}

// The rows history keeps are the shape the dashboard reads: a path, not a URL,
// and the reason a step failed in plain words.
func TestExecutionRowsAreWhatTheDashboardShows(t *testing.T) {
	base := "http://localhost:8080"
	res := &run.Result{
		Plan:    "Checkout applies the right tax rate",
		Status:  run.RunFailed,
		Elapsed: 1200 * time.Millisecond,
		Steps: []run.StepResult{
			{ID: "s1", Name: "Sign in", Method: "POST", URL: base + "/auth/login",
				Status: run.StepPassed, Code: 200, Elapsed: 120 * time.Millisecond},
			{ID: "s2", Name: "Apply tax", Method: "POST", URL: base + "/checkout/c_1/tax",
				Status: run.StepFailed, Code: 500, Elapsed: 90 * time.Millisecond,
				Checks: []run.Check{{Type: plan.Status, Operator: plan.Equals,
					Expected: "200", Actual: "500", Found: true}}},
			{ID: "s3", Name: "Read it back", Method: "GET", URL: base + "/checkout/c_1",
				Status: run.StepPending},
		},
	}

	e := execution("plan.json", base, time.Now(), res)

	if e.Plan != res.Plan || e.Status != "failed" || e.Duration != 1200*time.Millisecond {
		t.Errorf("got %+v", e)
	}
	if e.Steps[0].Path != "/auth/login" {
		t.Errorf("path = %q, want the base stripped", e.Steps[0].Path)
	}
	if e.Steps[1].Detail != "expected the status to be 200, got 500" {
		t.Errorf("detail = %q", e.Steps[1].Detail)
	}
	if e.Steps[2].Code != 0 || e.Steps[2].Detail != "" {
		t.Errorf("a step that never ran has nothing to report: %+v", e.Steps[2])
	}
}

// The hotel API's shape: one file per controller, reached by query string. The
// step carries a variable the route does not, so only its literal head matches.
func TestHandlersMatchAQueryStringRoute(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ReservationController.php"),
		[]byte("<?php class ReservationController { function addToBag() {} }"), 0o644); err != nil {
		t.Fatal(err)
	}

	find := handlers(dir, &index.Snapshot{Root: dir, Routes: []routes.Route{
		{File: "ReservationController.php", Method: "POST",
			Path: "/index.php?controller=reservations&action=addToBag"},
		{File: "RoomTypeController.php", Method: "GET",
			Path: "/index.php?controller=room_type&action=index"},
	}})

	got := find(plan.Step{Request: plan.Request{Method: "POST",
		URL: "/index.php?controller=reservations&action=addToBag&user_id={{guestId}}"}})
	if got.Path != "ReservationController.php" {
		t.Fatalf("matched %q", got.Path)
	}
	if !strings.Contains(got.Content, "addToBag") {
		t.Error("the handler's source is what repair reads")
	}

	if miss := find(plan.Step{Request: plan.Request{Method: "GET", URL: "/nothing/here"}}); miss.Path != "" {
		t.Errorf("a miss is fine, an invention is not: %+v", miss)
	}
}

// A file the index names but the tree no longer has is a miss, not a crash.
func TestHandlersSurviveAMissingFile(t *testing.T) {
	find := handlers(t.TempDir(), &index.Snapshot{Routes: []routes.Route{
		{File: "gone.php", Method: "GET", Path: "/gone"},
	}})
	if got := find(plan.Step{Request: plan.Request{Method: "GET", URL: "/gone"}}); got.Path != "" {
		t.Fatalf("%+v", got)
	}
}

func TestRepairNoteSaysWhichKindOfFailureItWas(t *testing.T) {
	cases := []struct {
		a    run.Attempt
		want string
	}{
		{run.Attempt{Err: "the model timed out"}, "timed out"},
		{run.Attempt{Refused: "repair may correct how a step asks"}, "declined"},
		{run.Attempt{Kind: run.CodeWrong, Why: "it dereferences a null discount"}, "the code looks wrong"},
		{run.Attempt{Kind: run.Unsure, Why: "the body says nothing"}, "could not tell"},
		{run.Attempt{Kind: run.TestWrong, Why: "guest_id is a query param",
			After: &plan.Step{}, Status: run.StepPassed}, "the test was wrong"},
		{run.Attempt{Kind: run.TestWrong, Why: "try the body instead",
			After: &plan.Step{}, Status: run.StepFailed}, "did not help"},
	}
	for _, c := range cases {
		if got := repairNote(c.a); !strings.Contains(got, c.want) {
			t.Errorf("%+v → %q, want it to mention %q", c.a, got, c.want)
		}
	}
}

// Every attempt becomes a revision, accepted or not, because a repairer reaching
// for a frozen field is the failure mode the guard exists for.
func TestRevisionsKeepDeclinedAttempts(t *testing.T) {
	before := plan.Step{ID: "s1", Name: "create an order",
		Request: plan.Request{Method: "POST", URL: "/orders"}}
	moved := before
	moved.Request.URL = "/orders?guest_id=g_1"

	got := revisions([]run.Attempt{
		{StepID: "s1", N: 1, Kind: run.TestWrong, Why: "guest_id is a query param",
			Before: before, After: &moved, Status: run.StepPassed},
		{StepID: "s1", N: 2, Kind: run.TestWrong, Why: "it returns 500",
			Before: before, After: &moved, Refused: "repair may correct how a step asks"},
	})

	if len(got) != 2 {
		t.Fatalf("%d revisions", len(got))
	}
	if !got[0].Accepted || got[1].Accepted {
		t.Errorf("accepted = %v, %v", got[0].Accepted, got[1].Accepted)
	}
	for i, r := range got {
		if r.Author != "ai" || r.Version != i+1 || r.Summary == "" {
			t.Errorf("revision %d: %+v", i, r)
		}
		if len(r.Changes) != 1 || r.Changes[0].Detail != "url" {
			t.Errorf("revision %d changes: %+v", i, r.Changes)
		}
	}
}

// The base URL points at a dead port, so naming the variable rather than the
// silence proves the check runs before anything is sent. The step reads the
// variable, which is what makes it this run's problem.
func TestRunRefusesAnUnsetVariableBeforeTouchingTheNetwork(t *testing.T) {
	cfg := conf(t, &config.Run{
		BaseURL:   "http://127.0.0.1:1",
		Variables: map[string]string{"adminPassword": "$GRITQA_NOT_EXPORTED"},
	})
	file := filepath.Join(t.TempDir(), "p.json")
	if err := os.WriteFile(file, []byte(`{"name":"p","version":1,"steps":[{"id":"s1",
		"request":{"method":"GET","url":"/x","headers":{"X-Pw":"{{adminPassword}}"}},
		"assertions":[{"type":"status",
		"operator":"equals","target":"status","expected":200}]}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	w, _ := writer()
	err := runPlan(context.Background(), w, cfg, Options{PlanFile: file})
	if err == nil || !strings.Contains(err.Error(), "adminPassword ($GRITQA_NOT_EXPORTED)") {
		t.Fatalf("got %v", err)
	}
}

// The other half of that contract: one stale mapping in run.variables used to refuse
// every plan on the machine, including the ones that never wanted the credential. This
// plan reads nothing, so it gets as far as the network and fails there instead.
func TestRunIgnoresAnUnsetVariableNoStepReads(t *testing.T) {
	cfg := conf(t, &config.Run{
		BaseURL:   "http://127.0.0.1:1",
		Variables: map[string]string{"adminPassword": "$GRITQA_NOT_EXPORTED"},
	})
	file := filepath.Join(t.TempDir(), "p.json")
	if err := os.WriteFile(file, []byte(`{"name":"p","version":1,"steps":[{"id":"s1",
		"request":{"method":"GET","url":"/x"},"assertions":[{"type":"status",
		"operator":"equals","target":"status","expected":200}]}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	w, _ := writer()
	err := runPlan(context.Background(), w, cfg, Options{PlanFile: file})
	if err == nil || strings.Contains(err.Error(), "adminPassword") {
		t.Fatalf("got %v", err)
	}
}

func TestShadowedNamesTheOverrideAndNotItsValue(t *testing.T) {
	w, out := writer()
	shadowed(w, &plan.Plan{Variables: map[string]string{
		"adminEmail": "drafted@example.com", "agreed": "same", "planOnly": "x",
	}}, map[string]string{
		"adminEmail": "admin@hotel.test", "agreed": "same", "configOnly": "y",
	})

	got := out.String()
	if !strings.Contains(got, "adminEmail") {
		t.Errorf("an overridden name should be named: %q", got)
	}
	for _, s := range []string{"agreed", "planOnly", "configOnly"} {
		if strings.Contains(got, s) {
			t.Errorf("%s is not shadowed: %q", s, got)
		}
	}
	for _, s := range []string{"admin@hotel.test", "drafted@example.com"} {
		if strings.Contains(got, s) {
			t.Errorf("a value reached the transcript: %q", got)
		}
	}
}

func TestNeedsVerdictCoversARefusedEditToo(t *testing.T) {
	cases := []struct {
		name string
		in   []run.Attempt
		want bool
	}{
		{"nothing repaired", nil, false},
		{"the test was wrong and the fix held", []run.Attempt{
			{Kind: run.TestWrong, Status: run.StepPassed}}, false},
		{"the code looks wrong", []run.Attempt{{Kind: run.CodeWrong}}, true},
		{"a frozen field was reached for", []run.Attempt{
			{Kind: run.TestWrong, Refused: "assertion 1 moved expected from 401 to 400"}}, true},
		{"the repairer itself failed", []run.Attempt{{Err: "timed out"}}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := needsVerdict(c.in); got != c.want {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

package app

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/term"
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

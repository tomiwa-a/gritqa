package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/cloud"
	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/creds"
	"github.com/gritqa/cli/internal/index"
)

// dashboard is the four /api/cli routes the loop talks to, and it settles the test
// by cancelling once a job has been reported one way or the other.
type dashboard struct {
	mu       sync.Mutex
	handed   bool
	report   cloud.Report
	released string
	settled  func()
}

func (d *dashboard) start(t *testing.T, job map[string]any) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/cli/index", func(w http.ResponseWriter, r *http.Request) {
		// The route M7a still owes on the web side. A 404 has to be survivable.
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"error": "not_found"})
	})
	mux.HandleFunc("/api/cli/jobs/claim", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		d.mu.Lock()
		defer d.mu.Unlock()
		out := map[string]any{"job": nil, "pollAfterMs": 50}
		if !d.handed {
			d.handed, out["job"] = true, job
		}
		json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("/api/cli/jobs/job_1/complete", func(w http.ResponseWriter, r *http.Request) {
		d.mu.Lock()
		json.NewDecoder(r.Body).Decode(&d.report)
		d.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "run": "run_1", "steps": 1})
		d.settled()
	})
	mux.HandleFunc("/api/cli/jobs/job_1/release", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Reason string }
		json.NewDecoder(r.Body).Decode(&in)
		d.mu.Lock()
		d.released = in.Reason
		d.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "outcome": "requeued"})
		d.settled()
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// linked puts a token where cloud.New will find it, in a config directory belonging
// to this test rather than to whoever is running it.
func linked(t *testing.T, server string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home+"/.config")

	store, err := creds.Open()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set(server, creds.Entry{Token: "a-token"}); err != nil {
		t.Fatal(err)
	}
}

// runPayload is plan_json as the dashboard stores it: covers included, name absent.
func runPayload(baseURL string) map[string]any {
	return map[string]any{
		"executionPublicId": "exec_1",
		"planPublicId":      "plan_1",
		"planName":          "room types",
		"planVersion":       2,
		"baseUrl":           baseURL,
		"plan": map[string]any{
			"variables": map[string]string{},
			"covers":    []map[string]string{{"method": "GET", "path": "/rooms"}},
			"steps": []map[string]any{{
				"id": "one", "name": "list rooms", "description": "", "dependsOn": []string{},
				"request": map[string]any{"method": "GET", "url": "/rooms"},
				"extract": []any{},
				"assertions": []map[string]any{
					{"type": "status", "operator": "equals", "target": "status", "expected": 200},
				},
				"onFailure": "abort",
			}},
		},
	}
}

func TestAttachRunsAClaimedPlan(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"rooms":[]}`))
	}))
	defer api.Close()

	d := &dashboard{}
	srv := d.start(t, map[string]any{
		"publicId": "job_1", "type": "execute_tests", "attempt": 1, "maxAttempts": 3,
		"payload": runPayload(api.URL),
	})
	linked(t, srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	d.settled = cancel

	w, out := writer()
	cfg := conf(t, &config.Run{})
	if err := attach(ctx, w, cfg, Options{Server: srv.URL}, &index.Snapshot{Root: cfg.Root()}, "", ""); err != nil {
		t.Fatal(err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	if d.report.Outcome != "passed" {
		t.Fatalf("outcome = %q, want passed — transcript:\n%s", d.report.Outcome, out)
	}
	if d.report.InstanceID == "" {
		t.Fatal("the report names no machine, so the dashboard has no row to move")
	}
	if len(d.report.Steps) != 1 {
		t.Fatalf("steps = %d, want 1", len(d.report.Steps))
	}
	s := d.report.Steps[0]
	if s.StepID != "one" || s.RoutePattern != "/rooms" || s.ResponseStatus != 200 {
		t.Fatalf("step reported as %+v", s)
	}
	if !strings.Contains(out.String(), "room types") {
		t.Fatalf("the transcript does not name the plan:\n%s", out)
	}
	if !strings.Contains(out.String(), "nowhere to put an index") {
		t.Fatalf("a dashboard with no index route was not reported:\n%s", out)
	}
}

// A job this machine cannot carry out goes back with its reason: a release keeps
// one, and a completion clears it.
func TestAttachGivesBackWhatItCannotDo(t *testing.T) {
	d := &dashboard{}
	srv := d.start(t, map[string]any{
		"publicId": "job_1", "type": "teach_it_to_dance", "attempt": 1, "maxAttempts": 3,
		"payload": map[string]any{},
	})
	linked(t, srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	d.settled = cancel

	w, _ := writer()
	cfg := conf(t, &config.Run{})
	if err := attach(ctx, w, cfg, Options{Server: srv.URL}, &index.Snapshot{Root: cfg.Root()}, "", ""); err != nil {
		t.Fatal(err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	if !strings.Contains(d.released, "teach_it_to_dance") {
		t.Fatalf("released with %q, which does not say what could not be done", d.released)
	}
	if d.report.Outcome != "" {
		t.Fatalf("a job it could not do was reported as a run: %q", d.report.Outcome)
	}
}

// An unreadable payload is the other half of that rule: this one was attempted, so
// the reason belongs on the run, where the report shows it.
func TestAttachSettlesAnUnreadablePayload(t *testing.T) {
	d := &dashboard{}
	srv := d.start(t, map[string]any{
		"publicId": "job_1", "type": "execute_tests", "attempt": 1, "maxAttempts": 3,
		"payload": map[string]any{"plan": map[string]any{"steps": "not a list"}},
	})
	linked(t, srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	d.settled = cancel

	w, _ := writer()
	cfg := conf(t, &config.Run{})
	if err := attach(ctx, w, cfg, Options{Server: srv.URL}, &index.Snapshot{Root: cfg.Root()}, "", ""); err != nil {
		t.Fatal(err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	if d.report.Outcome != "error" {
		t.Fatalf("outcome = %q, want error", d.report.Outcome)
	}
	if d.report.ErrorMessage == "" {
		t.Fatal("the run was settled as an error with no reason on it")
	}
}

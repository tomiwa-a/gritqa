package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/index/routes"
)

func sample() *reading {
	return &reading{
		snap: &index.Snapshot{
			Files: []index.File{
				{Path: "handlers/tax.go", Language: "go"},
				{Path: "handlers/orders.go", Language: "go"},
				{Path: "README.md", Language: "markdown"},
			},
			Routes: []routes.Route{
				{Method: "POST", Path: "/checkout/{id}/tax", File: "handlers/tax.go",
					Handler: "ApplyTax", Middleware: []string{"RequireAuth"}},
				{Method: "GET", Path: "/orders", File: "handlers/orders.go", Handler: "ListOrders"},
			},
		},
		delta: index.Delta{Changed: []string{"handlers/tax.go", "README.md"}},
	}
}

// A plan is drafted for what changed, and only files that register an endpoint
// can change what a plan should test.
func TestCandidatesAreChangedRouteFiles(t *testing.T) {
	got := candidates(sample())
	if len(got) != 1 || got[0] != "handlers/tax.go" {
		t.Fatalf("got %v", got)
	}
}

// On a first index nothing has changed yet, so every route file is fair game.
func TestCandidatesOnFirstIndex(t *testing.T) {
	got := sample()
	got.first, got.delta = true, index.Delta{}

	if names := strings.Join(candidates(got), " "); names != "handlers/orders.go handlers/tax.go" {
		t.Fatalf("got %q", names)
	}
}

func TestRequestCarriesWhatTheModelNeeds(t *testing.T) {
	cfg := config.New(t.TempDir(), "main")
	source := "func ApplyTax(w http.ResponseWriter, r *http.Request) {}"
	write(t, filepath.Join(cfg.Root(), "handlers/tax.go"), source)
	writeExisting(t, cfg)

	req, err := request(cfg, sample(), []string{"handlers/tax.go"}, "http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}

	if len(req.Files) != 1 || req.Files[0].Content != source || req.Files[0].Language != "go" {
		t.Fatalf("files = %+v", req.Files)
	}
	// Only the endpoints the changed files register — the rest is noise the model
	// pays for.
	if len(req.Endpoints) != 1 {
		t.Fatalf("endpoints = %+v", req.Endpoints)
	}
	e := req.Endpoints[0]
	if e.Handler != "ApplyTax" || !e.NeedsAuth || !strings.Contains(e.Signature, "/checkout") {
		t.Errorf("endpoint = %+v", e)
	}
	if len(req.Existing) != 1 || req.Existing[0].Name != "Partial refund skips shipped lines" {
		t.Fatalf("existing = %+v", req.Existing)
	}
	if got := req.Existing[0].Endpoints; len(got) != 1 || got[0] != "POST /refunds" {
		t.Errorf("existing endpoints = %v", got)
	}
	if req.BaseURL != "http://localhost:8080" || req.Project != cfg.Project {
		t.Errorf("req = %+v", req)
	}
}

// An earlier plan for the same change is history, not clutter.
func TestFreeNameNeverOverwrites(t *testing.T) {
	dir := t.TempDir()

	if got := freeName(dir, "checkout-tax"); got != "checkout-tax.json" {
		t.Fatalf("got %q", got)
	}
	write(t, filepath.Join(dir, "checkout-tax.json"), "{}")
	if got := freeName(dir, "checkout-tax"); got != "checkout-tax-2.json" {
		t.Fatalf("got %q", got)
	}
	write(t, filepath.Join(dir, "checkout-tax-2.json"), "{}")
	if got := freeName(dir, "checkout-tax"); got != "checkout-tax-3.json" {
		t.Fatalf("got %q", got)
	}
}

func TestSlug(t *testing.T) {
	for in, want := range map[string]string{
		"Checkout applies the right tax rate": "checkout-applies-the-right-tax-rate",
		"Refunds — only unshipped lines":      "refunds-only-unshipped-lines",
		"  ":                                  "plan",
		"POST /orders/:id":                    "post-orders-id",
	} {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeExisting(t *testing.T, cfg *config.Config) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"name":    "Partial refund skips shipped lines",
		"version": 1,
		"steps": []map[string]any{{
			"id":      "s1",
			"request": map[string]any{"method": "POST", "url": "/refunds"},
			"assertions": []map[string]any{
				{"type": "status", "operator": "equals", "target": "status", "expected": 200},
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(cfg.DraftsPath(), "partial-refund.json"), string(body))
}

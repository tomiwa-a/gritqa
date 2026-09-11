package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/draft"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

func sample() *reading {
	return &reading{
		snap: &index.Snapshot{
			Files: []index.File{
				{Path: "handlers/tax.go", Language: "go"},
				{Path: "handlers/orders.go", Language: "go"},
				{Path: "handlers/login.go", Language: "go"},
				{Path: "README.md", Language: "markdown"},
			},
			Routes: []routes.Route{
				{Method: "POST", Path: "/checkout/{id}/tax", File: "handlers/tax.go",
					Handler: "ApplyTax", Middleware: []string{"RequireAuth"}},
				{Method: "GET", Path: "/orders", File: "handlers/orders.go", Handler: "ListOrders"},
				{Method: "POST", Path: "/login", File: "handlers/login.go", Handler: "SignIn"},
			},
		},
		delta: index.Delta{Changed: []string{"handlers/tax.go", "README.md"}},
	}
}

// files names what a pass would draft for, as a comparable string.
func files(scopes []scope) string {
	var out []string
	for _, s := range scopes {
		if len(s.cover) > 0 {
			out = append(out, s.file+"["+strings.Join(s.cover, "|")+"]")
			continue
		}
		out = append(out, s.file)
	}
	return strings.Join(out, " ")
}

// A plan is drafted for what changed, and only files that register an endpoint
// can change what a plan should test.
func TestCandidatesAreChangedRouteFiles(t *testing.T) {
	got, _ := candidates(sample(), Options{})
	if files(got) != "handlers/tax.go" {
		t.Fatalf("got %v", files(got))
	}
}

// On a first index nothing has changed yet, so every route file is fair game.
func TestCandidatesOnFirstIndex(t *testing.T) {
	got := sample()
	got.first, got.delta = true, index.Delta{}

	want := "handlers/login.go handlers/orders.go handlers/tax.go"
	if names := files(candidatesOf(got, Options{})); names != want {
		t.Fatalf("got %q", names)
	}
}

func candidatesOf(got *reading, opts Options) []scope {
	scopes, _ := candidates(got, opts)
	return scopes
}

// --all is the override for a warm index where nothing changed, which is every
// index after the first one.
func TestAllIgnoresWhatChanged(t *testing.T) {
	got := sample()
	got.delta = index.Delta{}

	if names := files(candidatesOf(got, Options{All: true})); names !=
		"handlers/login.go handlers/orders.go handlers/tax.go" {
		t.Fatalf("got %q", names)
	}
	if names := files(candidatesOf(got, Options{})); names != "" {
		t.Fatalf("without --all, nothing changed, so got %q", names)
	}
}

// A name the user types picks a file whether or not it changed.
func TestOnlyPicksAFileByName(t *testing.T) {
	got, missed := candidates(sample(), Options{Only: []string{"orders"}})
	if files(got) != "handlers/orders.go" {
		t.Fatalf("got %q", files(got))
	}
	if len(missed) != 0 {
		t.Errorf("missed = %v", missed)
	}
}

// An endpoint signature narrows the plan to that endpoint, rather than taking
// the whole file it lives in.
func TestOnlyPicksAnEndpoint(t *testing.T) {
	got, _ := candidates(sample(), Options{Only: []string{"POST /checkout"}})
	if files(got) != "handlers/tax.go[POST /checkout/{id}/tax]" {
		t.Fatalf("got %q", files(got))
	}
}

// A pattern that matches nothing is reported, because a silent miss reads as a
// pass over something it never looked at.
func TestOnlyReportsAPatternThatMatchesNothing(t *testing.T) {
	got, missed := candidates(sample(), Options{Only: []string{"orders", "invoices"}})
	if files(got) != "handlers/orders.go" {
		t.Errorf("got %q", files(got))
	}
	if len(missed) != 1 || missed[0] != "invoices" {
		t.Fatalf("missed = %v", missed)
	}
}

// One request per file, each carrying its own source plus how to log in, and
// every endpoint the project serves so the plan can reach a guarded one.
func TestRequestsCarryWhatTheModelNeeds(t *testing.T) {
	cfg := config.New(t.TempDir(), "main")
	source := "func ApplyTax(w http.ResponseWriter, r *http.Request) {}"
	write(t, filepath.Join(cfg.Root(), "handlers/tax.go"), source)
	write(t, filepath.Join(cfg.Root(), "handlers/login.go"), "func SignIn() {}")
	writeExisting(t, cfg)

	reqs, labels, err := requests(cfg, sample(), whole([]string{"handlers/tax.go"}), Options{},
		"http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}
	if len(labels) != 1 || labels[0] != "handlers/tax.go" {
		t.Errorf("labels = %v", labels)
	}
	if len(reqs) != 1 {
		t.Fatalf("%d requests, want one per file", len(reqs))
	}
	req := reqs[0]

	if req.Focus != "handlers/tax.go" {
		t.Errorf("focus = %q", req.Focus)
	}
	if len(req.Files) != 2 || req.Files[0].Content != source || req.Files[0].Language != "go" {
		t.Fatalf("files = %+v", req.Files)
	}
	if req.Files[1].Path != "handlers/login.go" {
		t.Errorf("the second file should be how to log in, got %q", req.Files[1].Path)
	}
	if len(req.Endpoints) != 3 {
		t.Fatalf("endpoints = %+v, want every one the project serves", req.Endpoints)
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

// The login file is support for every other plan, and never sent to itself twice.
func TestSupportIsHowToLogIn(t *testing.T) {
	if got := support(sample().snap, "handlers/tax.go"); got != "handlers/login.go" {
		t.Errorf("got %q", got)
	}
	if got := support(sample().snap, "handlers/login.go"); got != "" {
		t.Errorf("got %q, want nothing", got)
	}
}

// One file the model cannot draft for does not cost the rest of the pass.
func TestFanKeepsGoingPastOneFailure(t *testing.T) {
	d := &fakeDrafter{}
	got := fan(context.Background(), d, []draft.Request{
		{Focus: "a.go"}, {Focus: "bad.go"}, {Focus: "c.go"},
	})

	if len(got) != 3 {
		t.Fatalf("%d results", len(got))
	}
	for i, want := range []string{"a.go", "", "c.go"} {
		switch {
		case want == "":
			if got[i].err == nil {
				t.Errorf("result %d should have failed", i)
			}
		case got[i].err != nil:
			t.Errorf("result %d: %v", i, got[i].err)
		case got[i].plan.Name != want:
			t.Errorf("result %d = %q, want %q", i, got[i].plan.Name, want)
		}
	}
}

// A drafter that fails on one file, so results stay aligned with their requests.
type fakeDrafter struct{}

func (f *fakeDrafter) Draft(ctx context.Context, req draft.Request) (*plan.Plan, error) {
	if req.Focus == "bad.go" {
		return nil, errors.New("the model wrote a plan I could not use")
	}
	return &plan.Plan{Name: req.Focus}, nil
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

// A brief collapses the pass into one plan: no focus file, the user's words as
// the authority, and every endpoint as the means.
func TestDescribeIsOnePlanFromABrief(t *testing.T) {
	cfg := config.New(t.TempDir(), "main")
	write(t, filepath.Join(cfg.Root(), "handlers/login.go"), "func SignIn() {}")

	opts := Options{Describe: "Book a room, then try to double-book it.", Name: "No double bookings"}
	reqs, labels, err := requests(cfg, sample(), nil, opts, "http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}
	if len(reqs) != 1 {
		t.Fatalf("%d requests, want one plan", len(reqs))
	}
	req := reqs[0]

	if req.Brief != opts.Describe || req.Name != opts.Name {
		t.Errorf("req = %+v", req)
	}
	if req.Focus != "" {
		t.Errorf("focus = %q, want none: the brief is what the plan is for", req.Focus)
	}
	if len(req.Endpoints) != 3 {
		t.Errorf("endpoints = %d, want every one", len(req.Endpoints))
	}
	if len(req.Files) != 1 || req.Files[0].Path != "handlers/login.go" {
		t.Fatalf("files = %+v, want how to log in and nothing else", req.Files)
	}
	if len(labels) != 1 || labels[0] != "your brief" {
		t.Errorf("labels = %v", labels)
	}
}

// --only with --describe is what source the one plan gets to read.
func TestDescribeReadsWhatOnlyPicked(t *testing.T) {
	cfg := config.New(t.TempDir(), "main")
	write(t, filepath.Join(cfg.Root(), "handlers/tax.go"), "func ApplyTax() {}")
	write(t, filepath.Join(cfg.Root(), "handlers/login.go"), "func SignIn() {}")

	opts := Options{Describe: "Tax a checkout twice.", Only: []string{"tax.go"}}
	scopes, _ := candidates(sample(), opts)
	reqs, _, err := requests(cfg, sample(), scopes, opts, "http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}

	var paths []string
	for _, f := range reqs[0].Files {
		paths = append(paths, f.Path)
	}
	if strings.Join(paths, " ") != "handlers/tax.go handlers/login.go" {
		t.Fatalf("files = %v", paths)
	}
}

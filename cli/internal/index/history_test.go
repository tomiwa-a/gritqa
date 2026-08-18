package index

import (
	"testing"
	"time"
)

func run(name string) *Execution {
	return &Execution{
		Plan:      name,
		PlanFile:  ".gritqa/drafts/" + name + ".json",
		Status:    "failed",
		Duration:  1200 * time.Millisecond,
		StartedAt: time.Date(2026, 8, 17, 9, 30, 0, 0, time.UTC),
		Steps: []StepRow{
			{StepID: "s1", Name: "Sign in", Status: "passed", Method: "POST",
				Path: "/auth/login", Code: 200, Duration: 120 * time.Millisecond},
			{StepID: "s2", Name: "Apply tax", Status: "failed", Method: "POST",
				Path: "/checkout/c_1/tax", Code: 500, Duration: 90 * time.Millisecond,
				Detail: "expected the status to be 200, got 500"},
			{StepID: "s3", Name: "Read it back", Status: "pending", Method: "GET",
				Path: "/checkout/c_1"},
		},
	}
}

func TestExecutionsRoundTrip(t *testing.T) {
	s := open(t, t.TempDir())

	if _, err := s.SaveExecution(run("checkout-tax")); err != nil {
		t.Fatal(err)
	}

	got, err := s.Executions(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("%d executions, want 1", len(got))
	}

	e := got[0]
	if e.Plan != "checkout-tax" || e.Status != "failed" || e.Duration != 1200*time.Millisecond {
		t.Errorf("got %+v", e)
	}
	if !e.StartedAt.Equal(run("x").StartedAt) {
		t.Errorf("startedAt = %s", e.StartedAt)
	}
	if len(e.Steps) != 3 {
		t.Fatalf("%d steps, want 3", len(e.Steps))
	}
	// Steps come back in the order they ran, not sorted by id or status.
	if e.Steps[0].StepID != "s1" || e.Steps[2].StepID != "s3" {
		t.Errorf("out of order: %+v", e.Steps)
	}
	if e.Steps[1].Code != 500 || e.Steps[1].Detail == "" {
		t.Errorf("the failing step lost its detail: %+v", e.Steps[1])
	}
	// A step that never ran has no status code and no duration, which is the
	// UI's null rather than a 0 anyone would read as real.
	if e.Steps[2].Code != 0 || e.Steps[2].Duration != 0 {
		t.Errorf("pending step: %+v", e.Steps[2])
	}
}

func TestExecutionsNewestFirst(t *testing.T) {
	s := open(t, t.TempDir())

	for _, name := range []string{"first", "second", "third"} {
		if _, err := s.SaveExecution(run(name)); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.Executions(2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Plan != "third" || got[1].Plan != "second" {
		t.Fatalf("got %d: %+v", len(got), got)
	}
}

// The index is a cache and gets rebuilt on a schema bump. History is not: until
// the server lands it is the only record a run ever happened.
func TestHistorySurvivesACacheRebuild(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)

	if _, err := s.SaveExecution(run("checkout-tax")); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(&Snapshot{Root: dir, Files: []File{{Path: "a.go", Language: "go", Hash: "h"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMeta("schema_version", "ancient"); err != nil {
		t.Fatal(err)
	}
	s.Close()

	again := open(t, dir)

	hashes, err := again.Hashes()
	if err != nil {
		t.Fatal(err)
	}
	if len(hashes) != 0 {
		t.Errorf("the cache should have been rebuilt, got %v", hashes)
	}

	got, err := again.Executions(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || len(got[0].Steps) != 3 {
		t.Fatalf("history did not survive: %+v", got)
	}
}

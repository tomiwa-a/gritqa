package index

import (
	"database/sql"
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

func TestRevisionsRoundTrip(t *testing.T) {
	s := open(t, t.TempDir())

	e := run("checkout-tax")
	e.Confirmed = sql.NullBool{Bool: false, Valid: true}
	e.ConfirmNote = "nothing checked that auth was enforced"
	e.Steps[1].Verdict = "real_bug"
	e.Revisions = []Revision{
		{StepID: "s2", Version: 1, Author: "ai", Summary: "guest_id belongs in the query",
			Accepted: true, Changes: []ChangeRow{
				{Kind: "value_changed", StepName: "Apply tax", Detail: "url",
					From: "/checkout/c_1/tax", To: "/checkout/c_1/tax?guest_id=g_1"},
			}},
		{StepID: "s2", Version: 2, Author: "ai", Summary: "the fix was declined", Accepted: false},
	}

	id, err := s.SaveExecution(e)
	if err != nil {
		t.Fatal(err)
	}

	revs, err := s.Revisions(id)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) != 2 {
		t.Fatalf("%d revisions, want 2", len(revs))
	}
	if revs[0].Version != 1 || !revs[0].Accepted || len(revs[0].Changes) != 1 {
		t.Fatalf("%+v", revs[0])
	}
	if revs[0].Changes[0].To != "/checkout/c_1/tax?guest_id=g_1" {
		t.Errorf("the change did not survive: %+v", revs[0].Changes[0])
	}
	if revs[1].Accepted || len(revs[1].Changes) != 0 {
		t.Errorf("a declined revision is kept as declined: %+v", revs[1])
	}

	got, err := s.Executions(1)
	if err != nil {
		t.Fatal(err)
	}
	if !got[0].Confirmed.Valid || got[0].Confirmed.Bool {
		t.Errorf("confirmed = %+v, want a stored false", got[0].Confirmed)
	}
	if got[0].ConfirmNote == "" {
		t.Error("the confirm note is the whole point of storing it")
	}
	if got[0].Steps[1].Verdict != "real_bug" || got[0].Steps[0].Verdict != "undecided" {
		t.Errorf("verdicts = %q, %q", got[0].Steps[0].Verdict, got[0].Steps[1].Verdict)
	}
}

// A cache written before M3 gains the three columns rather than losing its runs.
func TestUpgradeAddsColumnsToAnExistingHistory(t *testing.T) {
	dir := t.TempDir()

	s := open(t, dir)
	if _, err := s.SaveExecution(run("before-m3")); err != nil {
		t.Fatal(err)
	}
	for _, c := range added {
		if _, err := s.db.Exec("ALTER TABLE " + c.table + " DROP COLUMN " + c.column); err != nil {
			t.Fatalf("cannot fake the old shape: %v", err)
		}
	}
	s.Close()

	again := open(t, dir)
	got, err := again.Executions(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Plan != "before-m3" {
		t.Fatalf("the upgrade lost the run: %+v", got)
	}
	if got[0].Confirmed.Valid {
		t.Error("a run that predates confirm has no verdict on it")
	}
}

func TestStateLedgerRoundTrip(t *testing.T) {
	s := open(t, t.TempDir())

	e := run("guest-signup")
	e.StateNote = "one table could not be read"
	e.Moved = []MovedRow{
		{Unit: "guests", Rows: 3, From: "41", To: "44"},
		{Unit: "audit_logs", Rows: 3},
		{Unit: "bookings", Rows: -1, From: "12", To: "12"},
	}
	e.Steps[1].Moved = "guests +3, audit_logs +3"

	if _, err := s.SaveExecution(e); err != nil {
		t.Fatal(err)
	}
	got, err := s.Executions(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("%d executions, want 1", len(got))
	}

	// The order the ledger was written in is the order it is read back in: it was
	// already ranked by how far each unit moved.
	if len(got[0].Moved) != 3 {
		t.Fatalf("%d units, want 3: %+v", len(got[0].Moved), got[0].Moved)
	}
	for i, want := range e.Moved {
		if got[0].Moved[i] != want {
			t.Errorf("[%d] got %+v, want %+v", i, got[0].Moved[i], want)
		}
	}
	if got[0].StateNote != e.StateNote {
		t.Errorf("StateNote = %q, want %q", got[0].StateNote, e.StateNote)
	}
	if got[0].Steps[1].Moved != "guests +3, audit_logs +3" {
		t.Errorf("the step lost its delta: %q", got[0].Steps[1].Moved)
	}
	// A step that wrote nothing says so by saying nothing.
	if got[0].Steps[0].Moved != "" {
		t.Errorf("Steps[0].Moved = %q, want empty", got[0].Steps[0].Moved)
	}
}

// A read-only run records no ledger at all, rather than a row of zeroes.
func TestNoLedgerForARunThatTookNoReadings(t *testing.T) {
	s := open(t, t.TempDir())
	if _, err := s.SaveExecution(run("read-only")); err != nil {
		t.Fatal(err)
	}
	got, err := s.Executions(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got[0].Moved) != 0 {
		t.Errorf("Moved = %+v, want nothing", got[0].Moved)
	}
	if got[0].StateNote != "" {
		t.Errorf("StateNote = %q, want empty", got[0].StateNote)
	}
}

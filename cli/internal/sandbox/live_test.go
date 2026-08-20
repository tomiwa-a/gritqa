package sandbox

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// live is the real thing: Docker, a real MySQL, a real dump replayed. Off by
// default because it costs half a minute and a 1.1 GB image, and the rest of the
// package's tests have to stay runnable on a machine with neither.
func live(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("GRITQA_SANDBOX_TEST") != "1" {
		t.Skip("set GRITQA_SANDBOX_TEST=1 to run the Docker-backed tests")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker on PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	t.Cleanup(cancel)
	return ctx
}

// TestResetUndoesWritesTakenAfterTheBaseline is decision 27's proof, in one
// session: research writes to the same database execution runs against, so the
// restore has to put those rows back rather than merge over them.
func TestResetUndoesWritesTakenAfterTheBaseline(t *testing.T) {
	ctx := live(t)

	box, err := Up(ctx, Options{Image: "mysql:8", Database: "gritqa_live", Project: "live-test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { box.Down(context.Background()) })

	must := func(q string) {
		t.Helper()
		if _, err := box.DB().ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	must("CREATE TABLE things (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40))")
	must("INSERT INTO things (name) VALUES ('one'), ('two')")

	if err := box.Baseline(ctx); err != nil {
		t.Fatal(err)
	}
	if box.BaselineBytes() <= 0 {
		t.Fatal("the baseline reported no bytes")
	}

	before, err := box.Mark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	must("INSERT INTO things (name) VALUES ('three'), ('four'), ('five')")

	after, err := box.Watermark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	moved := after.Diff(before)
	if len(moved) != 1 || moved[0].Unit != "things" || moved[0].Rows != 3 {
		t.Fatalf("expected things +3, got %+v", moved)
	}
	if moved[0].From != "2" || moved[0].To != "5" {
		t.Fatalf("expected the key to move 2 → 5, got %s → %s", moved[0].From, moved[0].To)
	}

	if err := box.Reset(ctx); err != nil {
		t.Fatal(err)
	}

	var rows int64
	var hi int64
	if err := box.DB().QueryRowContext(ctx,
		"SELECT COUNT(*), COALESCE(MAX(id), 0) FROM things").Scan(&rows, &hi); err != nil {
		t.Fatal(err)
	}
	if rows != 2 || hi != 2 {
		t.Fatalf("after the reset the table holds %d rows up to %d, want 2 up to 2", rows, hi)
	}

	// The pool was rebuilt over a database that had been dropped, so the ledger
	// has to have re-learnt what it watches.
	if got := box.Tables(); len(got) != 1 || got[0] != "things" {
		t.Fatalf("after the reset the ledger watches %v", got)
	}
}

// TestDownLeavesNoContainer is the promise that docker ps never shows something
// the user cannot account for.
func TestDownLeavesNoContainer(t *testing.T) {
	ctx := live(t)

	box, err := Up(ctx, Options{Image: "mysql:8", Database: "gritqa_live", Project: "live-test"})
	if err != nil {
		t.Fatal(err)
	}
	name := box.Name()
	if !running(t, name) {
		t.Fatalf("%s is not running after Up", name)
	}
	if err := box.Down(ctx); err != nil {
		t.Fatal(err)
	}
	if running(t, name) {
		t.Fatalf("%s survived Down", name)
	}
	if err := box.Down(ctx); err != nil {
		t.Fatalf("a second Down should be harmless: %v", err)
	}
}

func running(t *testing.T, name string) bool {
	t.Helper()
	out, err := exec.Command("docker", "ps", "-a", "-q", "--filter", "name=^"+name+"$").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out)) != ""
}

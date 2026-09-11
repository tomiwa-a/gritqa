package app

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
)

// Both callers push unconditionally, so an unlinked project has to be the quiet
// case rather than a branch every call site remembers to write.
func TestAnUnlinkedProjectPushesNothingAndPanicsNowhere(t *testing.T) {
	var up *pushes
	if got := up.plan(context.Background(), "x.json", &plan.Plan{Name: "p"}, draftedHere); got != "" {
		t.Fatalf("planId = %q, want none", got)
	}
	up.run(context.Background(), "x.json", &plan.Plan{Name: "p"}, "http://x",
		time.Now(), &run.Result{Plan: "p"}, "")
}

// One file is one plan however it was named on the command line. Keyed otherwise,
// --plan .gritqa/drafts/x.json and --plan /abs/.../x.json are two plans on the
// dashboard for the same draft.
func TestOneDraftFileIsOneKey(t *testing.T) {
	root := t.TempDir()
	up := &pushes{root: root}

	rel := filepath.Join(".gritqa", "drafts", "x.json")
	abs := filepath.Join(root, rel)
	want := ".gritqa/drafts/x.json"

	if got := up.key(abs); got != want {
		t.Fatalf("key(absolute) = %q, want %q", got, want)
	}

	t.Chdir(root)
	if got := up.key(rel); got != want {
		t.Fatalf("key(relative) = %q, want %q", got, want)
	}
	if got := up.key("./" + want); got != want {
		t.Fatalf("key(dot-slash) = %q, want %q", got, want)
	}
}

// A plan somewhere else on the machine still has a key, and it is not a relative
// path climbing out of the project.
func TestAPlanOutsideTheProjectKeysAbsolute(t *testing.T) {
	up := &pushes{root: filepath.Join(t.TempDir(), "project")}
	outside := filepath.Join(t.TempDir(), "elsewhere", "x.json")

	got := up.key(outside)
	if got != filepath.ToSlash(outside) {
		t.Fatalf("key = %q, want the absolute path %q", got, outside)
	}
}

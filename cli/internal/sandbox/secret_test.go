package sandbox

import (
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/run"
)

// The password is the developer's own now, read out of their compose file rather
// than generated here, which is more reason to keep it out of what gets reported
// and not less. Every case below is a real surface: docker echoes its own stderr,
// a shell step's output is what assertions read, and a run's ledger is recorded.
func TestTheDevelopersPasswordStaysOut(t *testing.T) {
	c := Creds{User: "shop", Password: "fixture-only-password", Database: "shop"}
	pw := c.Password

	noisy := "FATAL: password authentication failed (using password: " + pw + ")\nand again: " + pw
	if got := c.scrub(noisy); strings.Contains(got, pw) {
		t.Errorf("scrub left the password in %q", got)
	}
	if !strings.Contains(c.scrub(noisy), "•••") {
		t.Error("scrub should say something was hidden")
	}

	s := &Stack{creds: c}
	if got := s.Secrets(); len(got) != 1 || got[0] != pw {
		t.Errorf("Secrets() = %v, want the value a step's report is masked against", got)
	}

	// A datastore with no credential, or one this build cannot read, has nothing to
	// mask -- and an empty entry in the mask list would redact every empty string.
	if got := (&Stack{}).Secrets(); len(got) != 0 {
		t.Errorf("Secrets() = %v for a stack with no password", got)
	}
	if got := c.scrub(noisy); (Creds{}).scrub(got) != got {
		t.Error("scrubbing against no password changed the text")
	}

	moved := mark(Row{Name: "guests", Rows: 2, High: "43"}).Diff(mark(Row{Name: "guests", Rows: 1, High: "41"}))
	for _, m := range moved {
		if strings.Contains(m.Unit+m.From+m.To, pw) {
			t.Errorf("the ledger carries the password: %+v", m)
		}
	}
}

// Engine.State is optional in exactly the way Repairer is, and the watermark is
// what satisfies it.
var (
	_ run.State = (*Stack)(nil)
	_ run.Mark  = (*Watermark)(nil)
)

func TestWatermarkStamped(t *testing.T) {
	w := &Watermark{At: time.Now()}
	if w.At.IsZero() {
		t.Error("a reading with no time cannot be ordered against another")
	}
}

// Docker puts the reason first and a useless "Run 'docker run --help'" last, and
// a denied mount is a Docker Desktop setting that unexplained reads as a bug here.
func TestDockerErrorsSayWhatWentWrong(t *testing.T) {
	if got := dockerReason("docker: no such image: x\n\nRun 'docker run --help' for more information\n"); got != "docker: no such image: x" {
		t.Errorf("dockerReason = %q", got)
	}
	denied := "docker: Error response from daemon: Mounts denied: \n" +
		"The path /Applications/XAMPP/xamppfiles/htdocs/hotel is not shared from the host " +
		"and is not known to Docker.\nRun 'docker run --help' for more information\n"
	got := dockerReason(denied)
	if !strings.Contains(got, "/Applications/XAMPP/xamppfiles/htdocs/hotel") {
		t.Errorf("the reason does not name the path: %q", got)
	}
	if !strings.Contains(got, "File Sharing") || !strings.Contains(got, "run.sandbox.mount") {
		t.Errorf("the reason does not say what to do: %q", got)
	}
	if dockerReason("   \n") != "no output" {
		t.Error("an empty failure should still say something")
	}
}

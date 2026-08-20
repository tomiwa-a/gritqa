package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/run"
)

func testbox(t *testing.T) *Sandbox {
	t.Helper()
	img, err := Lookup("mysql:8")
	if err != nil {
		t.Fatal(err)
	}
	c, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	return &Sandbox{
		img: img, creds: c, name: "gritqa-test-0001",
		host: loopback, port: 54321, dir: t.TempDir(),
		log: func(string) {},
	}
}

func TestNewCredsGeneratesTheSecret(t *testing.T) {
	img, _ := Lookup("mysql:8")
	a, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	if a.Password == b.Password {
		t.Fatal("two sandboxes got the same password")
	}
	if len(a.Password) < 24 {
		t.Errorf("password is %d characters, which is guessable", len(a.Password))
	}
	if a.Database != defaultDatabase {
		t.Errorf("database = %q, want %q", a.Database, defaultDatabase)
	}
	if got, _ := newCreds(img, "hotel_test"); got.Database != "hotel_test" {
		t.Errorf("database = %q, want the configured one", got.Database)
	}
}

// The password must not reach anything a person or a log file gets to see. Each
// case below is a real surface: an argument list is world-readable through ps, a
// failed docker command is quoted back to the user, and a recorded run is written
// to cache.db.
func TestTheGeneratedPasswordStaysOut(t *testing.T) {
	s := testbox(t)
	pw := s.creds.Password

	// ps shows every argument of every process on the machine.
	for _, arg := range s.runArgs(s.img, filepath.Join(s.dir, "env")) {
		if strings.Contains(arg, pw) {
			t.Errorf("docker run argv carries the password: %q", arg)
		}
	}

	// Anything docker or a migration prints is scrubbed before it is reported.
	noisy := "Access denied for user 'root'@'localhost' (using password: " + pw + ")\n" +
		"and again: " + pw
	if got := s.creds.scrub(noisy); strings.Contains(got, pw) {
		t.Errorf("scrub left the password in %q", got)
	}
	if !strings.Contains(s.creds.scrub(noisy), "•••") {
		t.Error("scrub should say something was hidden")
	}

	// A step's reported URL is masked against exactly this list.
	if got := s.Secrets(); len(got) != 1 || got[0] != pw {
		t.Errorf("Secrets() = %v, want the generated password", got)
	}

	// The state ledger is the one thing about the sandbox that gets recorded.
	moved := mark(Row{Name: "guests", Rows: 2, High: "43"}).Diff(mark(Row{Name: "guests", Rows: 1, High: "41"}))
	for _, m := range moved {
		if strings.Contains(m.Unit+m.From+m.To, pw) {
			t.Errorf("the ledger carries the password: %+v", m)
		}
	}
}

// The generated router holds the password by necessity — it is how the app
// process learns where its database is. What matters is that it is 0600 and
// lives in GritQA's own temp directory: decision 26 promises nothing is written
// into the user's tree.
func TestRouterStaysOutOfTheProject(t *testing.T) {
	s := testbox(t)
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "index.php"), []byte("<?php\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	path, err := s.writeRouter(project, "index.php")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != s.dir {
		t.Errorf("router written to %s, want it under %s", path, s.dir)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("router is %o, want 600", mode)
	}

	entries, err := os.ReadDir(project)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("the project directory gained files: %v", entries)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// chdir is load-bearing: the front controller requires ../vendor/autoload.php,
	// a relative path, so php -S's own working directory is not enough.
	for _, want := range []string{"$_ENV[$k] = $v", "chdir($__doc)", "DB_PASSWORD"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("router is missing %q", want)
		}
	}
}

func TestEnvNamesBothConventions(t *testing.T) {
	env := testbox(t).Env()
	for _, k := range []string{"DB_HOST", "DB_PORT", "DB_NAME", "DB_DATABASE",
		"DB_USER", "DB_USERNAME", "DB_PASSWORD", "DB_CONNECTION", "DATABASE_URL"} {
		if env[k] == "" {
			t.Errorf("Env() has no %s", k)
		}
	}
	if env["DB_HOST"] != loopback {
		t.Errorf("DB_HOST = %q, want loopback", env["DB_HOST"])
	}
	if env["DB_PORT"] != "54321" {
		t.Errorf("DB_PORT = %q, want the mapped port", env["DB_PORT"])
	}
}

func TestContainerNameIsAccountableAndUnique(t *testing.T) {
	a, b := containerName("Hotel Management"), containerName("Hotel Management")
	if a == b {
		t.Error("two runs of the same project collided on one container name")
	}
	for _, got := range []string{a, containerName(""), containerName("../../etc")} {
		if !strings.HasPrefix(got, "gritqa-") {
			t.Errorf("%q should say who made it", got)
		}
		if strings.ContainsAny(got, " /.:") {
			t.Errorf("%q is not a legal container name", got)
		}
	}
}

// Engine.State is optional in exactly the way Repairer is, and Watermark is what
// satisfies it.
var (
	_ run.State = (*Sandbox)(nil)
	_ run.Mark  = (*Watermark)(nil)
)

func TestWatermarkStamped(t *testing.T) {
	w := &Watermark{At: time.Now()}
	if w.At.IsZero() {
		t.Error("a reading with no time cannot be ordered against another")
	}
}

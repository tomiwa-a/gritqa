package sandbox

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/run"
)

// Stack is a running copy of the developer's project, brought up on their own
// compose file through the document Overlay generated. It is a copy in the strict
// sense: its own project name, its own volumes, its own ephemeral ports, and a
// read-only view of the source, so bringing it up and tearing it down leaves
// whatever the developer has running untouched.
//
// Nothing here interprets the project. Which service to publish, which to connect
// to, and what brings the schema up all come from the Environment.
type Stack struct {
	project string
	files   []string
	dir     string
	// boot are the profiles that gate the app and the database, and nothing else.
	boot    []string
	env     Environment
	creds   Creds
	base    string
	appPort int
	dbPort  int
	db      *sql.DB
	ready   time.Duration
	watcher *Watcher
	tables  []string
	log     func(string)
}

type LaunchOptions struct {
	Compose     *Compose
	Environment Environment
	// Name prefixes the compose project, so docker ps reads as something the user
	// can account for. The compose fingerprint is appended.
	Name string
	// Ready bounds the wait for the app's port and the database to answer.
	Ready time.Duration
	// Tables limits what the ledger watches. Empty watches every base table.
	Tables     []string
	OnProgress func(string)
}

// Launch brings the copy up and returns once its app port answers and, when the
// environment names a database, that database accepts a connection. The caller
// owns Down.
func Launch(ctx context.Context, opts LaunchOptions) (*Stack, error) {
	if _, err := exec.LookPath("docker"); err != nil {
		return nil, errors.New("GritQA boots a project through its own compose file, and docker " +
			"is not on your PATH")
	}
	c, e := opts.Compose, opts.Environment
	if c == nil {
		return nil, errors.New("there is no compose file to boot")
	}
	if err := e.Check(c); err != nil {
		return nil, err
	}

	project := projectName(opts.Name, c.Fingerprint)
	overlay, err := c.Overlay(e, project)
	if err != nil {
		return nil, err
	}
	creds := Creds{}
	if e.Database != "" {
		if creds, err = e.Resolve(c); err != nil {
			return nil, err
		}
	}

	dir, err := os.MkdirTemp("", "gritqa-stack-")
	if err != nil {
		return nil, err
	}
	generated := filepath.Join(dir, "gritqa.compose.yaml")
	if err := os.WriteFile(generated, overlay.Document, 0o600); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}

	s := &Stack{
		project: project,
		files:   []string{generated},
		dir:     dir,
		boot:    bootProfiles(c, e),
		env:     e,
		creds:   creds,
		tables:  opts.Tables,
		log:     opts.OnProgress,
	}
	if s.log == nil {
		s.log = func(string) {}
	}
	for _, p := range overlay.Dropped {
		s.log("not publishing " + p + ", which your own stack may be using")
	}
	for _, d := range overlay.Detached {
		s.log("not joining " + d + ", because it belongs to something you are already running")
	}

	s.ready = opts.Ready
	if s.ready <= 0 {
		s.ready = defaultReady
	}
	if err := s.up(ctx, s.ready); err != nil {
		s.Down(context.WithoutCancel(ctx))
		return nil, err
	}
	return s, nil
}

func (s *Stack) up(ctx context.Context, ready time.Duration) error {
	s.log("building and starting " + s.project + " from your compose file")
	if out, err := s.run(ctx, s.bootArgs(), "up", "-d", "--wait", "--wait-timeout",
		strconv.Itoa(int(ready.Seconds()))); err != nil {
		return fmt.Errorf("your compose file did not come up:\n%s", out)
	}

	var err error
	if s.appPort, err = s.mapped(ctx, s.env.App, s.env.Port); err != nil {
		return err
	}
	s.base = fmt.Sprintf("http://%s:%d", loopback, s.appPort)
	if err := s.awaitApp(ctx, ready); err != nil {
		return err
	}
	if s.env.Database == "" {
		return nil
	}
	if s.dbPort, err = s.mapped(ctx, s.env.Database, s.env.DBPort); err != nil {
		return err
	}
	if !s.env.Watched() {
		s.log(fmt.Sprintf("%s is up on port %d, and this build has no %s client — nothing here "+
			"reads it, so a run's ledger will say its data went unwatched rather than imply "+
			"otherwise. Its own image ships a client, which Exec reaches",
			s.env.Database, s.dbPort, s.env.Driver))
		return nil
	}
	return s.awaitDB(ctx, ready)
}

// awaitApp dials the port and nothing more. Whether the app is *working* is a
// question about the project, and answering it here would mean guessing at a
// health path GritQA was never told about.
func (s *Stack) awaitApp(ctx context.Context, limit time.Duration) error {
	addr := fmt.Sprintf("%s:%d", loopback, s.appPort)
	deadline := time.Now().Add(limit)
	for {
		conn, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "tcp", addr)
		if err == nil {
			conn.Close()
			s.log(s.env.App + " answering on " + s.base)
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if running, why := s.up1(ctx, s.env.App); !running {
			return fmt.Errorf("%s started and then stopped: %s", s.env.App, why)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s never answered on port %d within %s — "+
				"if it serves on a different port, that is what the environment should say",
				s.env.App, s.env.Port, limit)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func (s *Stack) awaitDB(ctx context.Context, limit time.Duration) error {
	dsn := Driver(s.env.Driver).DSN(loopback, s.dbPort, s.creds)
	db, err := sql.Open(s.env.Driver, dsn)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(4)
	db.SetConnMaxLifetime(0)
	s.db = db

	deadline := time.Now().Add(limit)
	for {
		if err := db.PingContext(ctx); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if running, why := s.up1(ctx, s.env.Database); !running {
			return fmt.Errorf("%s started and then stopped: %s", s.env.Database, why)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s never accepted a %s connection within %s",
				s.env.Database, s.env.Driver, limit)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// Schema runs what the environment says brings the schema up, in order. Each step
// is one compose run, so a service parked behind a profile is started for the step
// and removed after it, which is what a one-off runner is for.
func (s *Stack) Schema(ctx context.Context) error {
	for _, step := range s.env.Schema {
		what := step.Service
		if len(step.Run) > 0 {
			what += ": " + strings.Join(step.Run, " ")
		}
		s.log("running " + what)

		args := append([]string{"run", "--rm", "-T", step.Service}, step.Run...)
		out, err := s.compose(ctx, args...)
		if err != nil {
			return fmt.Errorf("%s failed:\n%s", what, out)
		}
	}
	return nil
}

// Baseline works out what the ledger will watch, and is called after the schema
// steps rather than at boot: discovering against an empty datastore would watch
// nothing and then report that nothing ever moved.
//
// A store this build has no client for still gets a watcher -- it counts the
// directories the app writes to and nothing else, which is honestly less than a
// full reading and more than none.
func (s *Stack) Baseline(ctx context.Context) error {
	s.watcher = NewWatcher(s.db, Driver(s.env.Driver), s.creds)
	s.watcher.Counting(s.countFiles)
	s.watcher.Watch(s.env.Writable...)
	if err := s.watcher.Discover(ctx, s.tables); err != nil {
		return err
	}
	switch {
	case !s.watcher.Reads():
		s.log(fmt.Sprintf("watching %s and taking no readings from %s",
			plural(len(s.env.Writable), "directory", "directories"), s.env.Database))
	default:
		s.log(fmt.Sprintf("baseline taken — %s", plural(len(s.watcher.Tables()), "table", "tables")))
	}
	return nil
}

// Reset returns the copy to what the project's own schema steps produce. It clears
// the volumes and boots again rather than restoring a dump, so it needs to know
// nothing about the protocol and holds for a datastore GritQA cannot even read.
//
// Always before a run: the read tools reach this same copy, and a plan that passes
// on a row research left behind is worse than one that fails.
func (s *Stack) Reset(ctx context.Context) error {
	if s.db != nil {
		s.db.Close()
		s.db = nil
	}
	if out, err := s.compose(ctx, "down", "-v", "--remove-orphans"); err != nil {
		return fmt.Errorf("could not clear the copy:\n%s", out)
	}
	if err := s.up(ctx, s.ready); err != nil {
		return err
	}
	if err := s.Schema(ctx); err != nil {
		return err
	}
	return s.Baseline(ctx)
}

// countFiles asks the app's own container, because a writable path is a volume
// there and the host has no view of it. The count is what the ledger needs -- an
// upload landed -- and a modification time is not worth an image-dependent find.
func (s *Stack) countFiles(ctx context.Context, dir string) (int64, time.Time, error) {
	out, _, _, err := s.Exec(ctx, s.env.App, "find "+dir+" -type f 2>/dev/null | wc -l")
	if err != nil {
		return 0, time.Time{}, err
	}
	n, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("could not count files in %s: %q", dir, out)
	}
	return n, time.Time{}, nil
}

// Watcher is the ledger's reader, and nil until Baseline has run.
func (s *Stack) Watcher() *Watcher { return s.watcher }

// Mark satisfies run.State, so a walk against the copy reports what it moved.
func (s *Stack) Mark(ctx context.Context) (run.Mark, error) { return s.watcher.Mark(ctx) }

func (s *Stack) Tables() []string {
	if s.watcher == nil {
		return nil
	}
	return s.watcher.Tables()
}

func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// Exec runs one line inside a throwaway container off a service's own image, on
// the copy's network and with its environment. The service is the project's, so
// the toolchain is whatever the project ships.
func (s *Stack) Exec(ctx context.Context, service, command string) (stdout, stderr string, exitCode int, err error) {
	if service == "" {
		service = s.env.App
	}
	args := append(s.baseArgs(), "run", "--rm", "-T", "--entrypoint", "sh", service, "-c", command)
	cmd := exec.CommandContext(ctx, "docker", args...)
	var out, errs bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errs
	runErr := cmd.Run()
	stdout = s.creds.scrub(strings.TrimSpace(out.String()))
	stderr = s.creds.scrub(strings.TrimSpace(errs.String()))

	if runErr == nil {
		return stdout, stderr, 0, nil
	}
	if ce := ctx.Err(); ce != nil {
		return stdout, stderr, 0, ce
	}
	var exit *exec.ExitError
	if errors.As(runErr, &exit) {
		return stdout, stderr, exit.ExitCode(), nil
	}
	return stdout, stderr, 1, fmt.Errorf("docker compose run: %w", runErr)
}

// ShellExec is Exec in the shape run.Engine takes it. A shell step names no
// service because the app's own image is where the project's toolchain is.
func (s *Stack) ShellExec(ctx context.Context, command string) (string, string, int, error) {
	return s.Exec(ctx, s.env.App, command)
}

// Down removes everything the copy created, volumes included. Safe to call twice,
// because a signal handler and a deferred close both reach it.
func (s *Stack) Down(ctx context.Context) error {
	if s == nil {
		return nil
	}
	var first error
	if s.db != nil {
		first = s.db.Close()
		s.db = nil
	}
	if len(s.files) > 0 {
		// -v takes the copy's volumes, which are the copy's because Overlay dropped
		// every name compose had resolved. --remove-orphans catches a service the
		// document no longer declares.
		if _, err := s.compose(ctx, "down", "-v", "--remove-orphans"); err != nil {
			if first == nil {
				first = err
			}
		} else {
			s.files = nil
		}
	}
	if s.dir != "" {
		if err := os.RemoveAll(s.dir); err != nil && first == nil {
			first = err
		}
		s.dir = ""
	}
	return first
}

func (s *Stack) BaseURL() string  { return s.base }
func (s *Stack) DB() *sql.DB      { return s.db }
func (s *Stack) Project() string  { return s.project }
func (s *Stack) DSN() string      { return Driver(s.env.Driver).DSN(loopback, s.dbPort, s.creds) }
func (s *Stack) Database() string { return s.creds.Database }

// Secrets are the values that must not survive into a transcript or a prompt. The
// password here is the developer's own, out of their compose file, which is more
// reason to mask it than less.
func (s *Stack) Secrets() []string {
	if s.creds.Password == "" {
		return nil
	}
	return []string{s.creds.Password}
}

// mapped reads the loopback port compose published a container port on.
func (s *Stack) mapped(ctx context.Context, service string, container int) (int, error) {
	out, err := s.compose(ctx, "port", service, strconv.Itoa(container))
	if err != nil {
		return 0, fmt.Errorf("could not find what port %s published for %d: %s", service, container, out)
	}
	if strings.TrimSpace(out) == "" {
		return 0, fmt.Errorf("%s is up but nothing is published for port %d", service, container)
	}
	return firstPort(out, container)
}

// up1 reports whether one service is still running, and why it is not.
func (s *Stack) up1(ctx context.Context, service string) (bool, string) {
	out, err := s.compose(ctx, "ps", "-q", service)
	if err != nil || strings.TrimSpace(out) == "" {
		return false, "the container is gone"
	}
	id := strings.Fields(out)[0]
	state, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", id).Output()
	if err != nil {
		return false, "the container is gone"
	}
	if strings.TrimSpace(string(state)) == "true" {
		return true, ""
	}
	logs, _ := s.compose(ctx, "logs", "--tail", "12", service)
	return false, lastLine(logs)
}

// baseArgs asks for every profile, so a schema step parked behind one can be run
// and a teardown reaches whatever a step left behind.
func (s *Stack) baseArgs() []string { return s.args("*") }

// bootArgs asks only for the profiles gating the app and the database. Every
// profile would be wrong here: up starts what its profiles select, and a project
// parks a one-shot migrator behind a profile precisely so it does not run on boot.
func (s *Stack) bootArgs() []string { return s.args(s.boot...) }

func (s *Stack) args(profiles ...string) []string {
	args := []string{"compose", "-p", s.project}
	for _, f := range s.files {
		args = append(args, "-f", f)
	}
	for _, p := range profiles {
		args = append(args, "--profile", p)
	}
	return args
}

func bootProfiles(c *Compose, e Environment) []string {
	var out []string
	seen := map[string]bool{}
	for _, name := range []string{e.App, e.Database} {
		svc, ok := c.Service(name)
		if !ok {
			continue
		}
		for _, p := range svc.Profiles {
			if !seen[p] {
				seen[p], out = true, append(out, p)
			}
		}
	}
	return out
}

func (s *Stack) compose(ctx context.Context, args ...string) (string, error) {
	return s.run(ctx, s.baseArgs(), args...)
}

func (s *Stack) run(ctx context.Context, base []string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", append(base, args...)...)
	out, err := cmd.CombinedOutput()
	text := s.creds.scrub(strings.TrimSpace(string(out)))
	if err != nil {
		if text == "" {
			return "", cancelled(ctx, err)
		}
		return text, cancelled(ctx, errors.New(dockerReason(text)))
	}
	return text, nil
}

// projectName is what namespaces the copy. Compose is strict about the character
// set, and the fingerprint is what makes two projects on one machine distinct.
func projectName(name, fingerprint string) string {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		}
		return '-'
	}, name)
	clean = strings.Trim(clean, "-_")
	if clean == "" {
		clean = "project"
	}
	if len(clean) > 24 {
		clean = strings.Trim(clean[:24], "-_")
	}
	if len(fingerprint) > 8 {
		fingerprint = fingerprint[:8]
	}
	return fmt.Sprintf("gritqa-%s-%s", clean, fingerprint)
}

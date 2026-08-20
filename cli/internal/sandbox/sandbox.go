// Package sandbox brings up a throwaway database GritQA owns, migrates and seeds
// it with the project's own tooling, and reports what a test run moved inside it.
//
// It exists for the safety story, not just for isolation: because GritQA created
// the instance and generated its password, the user's real database and their
// .env are never opened.
package sandbox

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// The driver logs every failed connection to stderr, and await deliberately fails
// dozens of them while the image runs its first-boot setup. Every error that
// matters is reported with its own context, so the raw log is only noise.
func init() { mysql.SetLogger(log.New(io.Discard, "", 0)) }

type Options struct {
	// Image is the database image, "mysql:8" shaped.
	Image string
	// Database names the schema created on first boot.
	Database string
	// Project labels the container, so docker ps reads as something the user can
	// account for.
	Project string
	// Tables limits what Watermark watches. Empty watches every base table.
	Tables []string
	// OnProgress narrates the slow parts — a pull is minutes on a cold machine.
	OnProgress func(string)
	// Ready bounds the wait for the database to accept connections.
	Ready time.Duration
}

type Sandbox struct {
	img      Image
	creds    Creds
	name     string
	host     string
	port     int
	db       *sql.DB
	dir      string
	units    []unit
	only     []string
	baseline *Snapshot
	watch    []string
	log      func(string)
}

const (
	defaultReady = 90 * time.Second
	loopback     = "127.0.0.1"
)

// Up creates the container and returns once the database answers. The caller
// owns Down: nothing else reaps it, so a container never outlives the process
// that made it.
func Up(ctx context.Context, opts Options) (*Sandbox, error) {
	if _, err := exec.LookPath("docker"); err != nil {
		return nil, errors.New("run.sandbox needs Docker, and docker is not on your PATH")
	}
	img, err := Lookup(opts.Image)
	if err != nil {
		return nil, err
	}
	if !img.Supported {
		return nil, fmt.Errorf("GritQA recognises %s but this build has no %s driver linked in — "+
			"use one of %s for now", img.Ref, img.Driver, strings.Join(Names(), ", "))
	}
	creds, err := newCreds(img, opts.Database)
	if err != nil {
		return nil, err
	}

	dir, err := os.MkdirTemp("", "gritqa-sandbox-")
	if err != nil {
		return nil, err
	}

	s := &Sandbox{
		img:   img,
		creds: creds,
		name:  containerName(opts.Project),
		host:  loopback,
		dir:   dir,
		log:   opts.OnProgress,
	}
	if s.log == nil {
		s.log = func(string) {}
	}

	if err := s.start(ctx, img); err != nil {
		s.cleanup(context.WithoutCancel(ctx))
		return nil, err
	}
	ready := opts.Ready
	if ready <= 0 {
		ready = defaultReady
	}
	if err := s.await(ctx, ready); err != nil {
		s.cleanup(context.WithoutCancel(ctx))
		return nil, err
	}
	if err := s.writeClientConfig(ctx); err != nil {
		s.cleanup(context.WithoutCancel(ctx))
		return nil, err
	}
	s.only = opts.Tables
	if s.units, err = s.discover(ctx, s.only); err != nil {
		s.cleanup(context.WithoutCancel(ctx))
		return nil, err
	}
	return s, nil
}

func (s *Sandbox) start(ctx context.Context, img Image) error {
	if err := s.pull(ctx, img.Ref); err != nil {
		return err
	}

	// The password goes in a 0600 env file rather than on the command line: an
	// argument is visible to every process on the machine through ps.
	envFile := filepath.Join(s.dir, "env")
	body := fmt.Sprintf("%s=%s\n%s=%s\n", img.Password, s.creds.Password, img.Database, s.creds.Database)
	if err := os.WriteFile(envFile, []byte(body), 0o600); err != nil {
		return err
	}
	defer os.Remove(envFile)

	// Published on loopback only. A seeded database reachable from the LAN is a
	// worse hole than the one this package closes.
	if _, err := s.docker(ctx, s.runArgs(img, envFile)...); err != nil {
		return fmt.Errorf("could not start %s: %w", img.Ref, err)
	}

	mapped, err := s.mappedPort(ctx, img.Port)
	if err != nil {
		return err
	}
	s.port = mapped
	return nil
}

func (s *Sandbox) runArgs(img Image, envFile string) []string {
	return []string{"run", "-d",
		"--name", s.name,
		"--label", "gritqa=1",
		"--env-file", envFile,
		"-p", fmt.Sprintf("%s::%d", loopback, img.Port),
		img.Ref,
	}
}

func (s *Sandbox) pull(ctx context.Context, ref string) error {
	if _, err := s.docker(ctx, "image", "inspect", ref); err == nil {
		return nil
	}
	s.log("pulling " + ref + ", which happens once")
	if _, err := s.docker(ctx, "pull", ref); err != nil {
		return fmt.Errorf("could not pull %s: %w", ref, err)
	}
	return nil
}

func (s *Sandbox) mappedPort(ctx context.Context, container int) (int, error) {
	out, err := s.docker(ctx, "port", s.name, fmt.Sprintf("%d/tcp", container))
	if err != nil {
		return 0, err
	}
	// "127.0.0.1:54321", possibly several lines when both families are bound.
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if i := strings.LastIndexByte(line, ':'); i >= 0 {
			if n, err := strconv.Atoi(strings.TrimSpace(line[i+1:])); err == nil && n > 0 {
				return n, nil
			}
		}
	}
	return 0, fmt.Errorf("docker published no port for %d", container)
}

// await polls until the database answers. The port opens before the server is
// ready — MySQL's entrypoint runs an init pass first — so this pings rather than
// dialling, and re-checks that the container is still up so a crash during init
// is reported as itself rather than as a timeout.
func (s *Sandbox) await(ctx context.Context, limit time.Duration) error {
	db, err := sql.Open(string(s.img.Driver), s.img.DSN(s.host, s.port, s.creds))
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(4)
	db.SetConnMaxLifetime(0)
	s.db = db

	deadline := time.Now().Add(limit)
	slow := time.Now().Add(5 * time.Second)
	warned := false
	for {
		if err := db.PingContext(ctx); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if running, why := s.alive(ctx); !running {
			return fmt.Errorf("%s started and then stopped: %s", s.img.Ref, why)
		}
		if !warned && time.Now().After(slow) {
			s.log("waiting for " + s.img.Ref + " to finish its first-boot setup")
			warned = true
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s never accepted a connection within %s", s.img.Ref, limit)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func (s *Sandbox) alive(ctx context.Context) (bool, string) {
	out, err := s.docker(ctx, "inspect", "-f", "{{.State.Running}}", s.name)
	if err != nil {
		return false, "the container is gone"
	}
	if strings.TrimSpace(out) == "true" {
		return true, ""
	}
	logs, _ := s.docker(ctx, "logs", "--tail", "12", s.name)
	return false, lastLine(logs)
}

// writeClientConfig plants the password inside the container so mysqldump and
// mysql need no password argument, keeping it out of ps for those calls too.
func (s *Sandbox) writeClientConfig(ctx context.Context) error {
	if s.img.Driver != MySQL {
		return nil
	}
	body := fmt.Sprintf("[client]\nuser=%s\npassword=%s\n", s.creds.User, s.creds.Password)
	cmd := exec.CommandContext(ctx, "docker", "exec", "-i", "-u", "root", s.name,
		"sh", "-c", "umask 077; cat > /root/.my.cnf")
	cmd.Stdin = strings.NewReader(body)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("could not configure the sandbox client: %s", s.creds.scrub(string(out)))
	}
	return nil
}

// Down removes the container and the temp directory. Safe to call twice, because
// a signal handler and a deferred close will both reach it.
func (s *Sandbox) Down(ctx context.Context) error {
	if s == nil {
		return nil
	}
	return s.cleanup(ctx)
}

func (s *Sandbox) cleanup(ctx context.Context) error {
	var first error
	if s.db != nil {
		if err := s.db.Close(); err != nil {
			first = err
		}
		s.db = nil
	}
	if s.name != "" {
		if _, err := s.docker(ctx, "rm", "-f", "-v", s.name); err != nil && first == nil {
			first = err
		}
		s.name = ""
	}
	if s.dir != "" {
		if err := os.RemoveAll(s.dir); err != nil && first == nil {
			first = err
		}
		s.dir = ""
	}
	return first
}

func (s *Sandbox) DB() *sql.DB   { return s.db }
func (s *Sandbox) Port() int     { return s.port }
func (s *Sandbox) Name() string  { return s.name }
func (s *Sandbox) Image() string { return s.img.Ref }

// DSN is the connection string. It carries the generated password, so it is for
// handing to a driver and never for printing.
func (s *Sandbox) DSN() string { return s.img.DSN(s.host, s.port, s.creds) }

// Env is what a migration or the app process needs to reach the sandbox. The
// DB_* names are what a PHP or Rails project reads; DATABASE_URL is what a Go or
// Node one reads. Both are set because nothing says which the project is.
func (s *Sandbox) Env() map[string]string {
	port := strconv.Itoa(s.port)
	return map[string]string{
		"DB_HOST":       s.host,
		"DB_PORT":       port,
		"DB_NAME":       s.creds.Database,
		"DB_DATABASE":   s.creds.Database,
		"DB_USER":       s.creds.User,
		"DB_USERNAME":   s.creds.User,
		"DB_PASSWORD":   s.creds.Password,
		"DB_CONNECTION": string(s.img.Driver),
		"DATABASE_URL": fmt.Sprintf("%s://%s:%s@%s:%s/%s",
			s.img.Driver, s.creds.User, s.creds.Password, s.host, port, s.creds.Database),
	}
}

// Secrets are the values that must not survive into a transcript or a prompt,
// in the shape run.Engine.Secrets takes.
func (s *Sandbox) Secrets() []string { return []string{s.creds.Password} }

func (s *Sandbox) docker(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()
	text := s.creds.scrub(strings.TrimSpace(string(out)))
	if err != nil {
		if text == "" {
			return "", cancelled(ctx, err)
		}
		return text, cancelled(ctx, errors.New(lastLine(text)))
	}
	return text, nil
}

// cancelled turns a subprocess killed by a Ctrl-C into the reason it was killed.
// Without it an interrupted mysqldump reads as a database that would not answer,
// and main.go loses the 130 it maps context.Canceled to.
func cancelled(ctx context.Context, err error) error {
	if ce := ctx.Err(); ce != nil {
		return ce
	}
	return err
}

func containerName(project string) string {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		}
		return '-'
	}, project)
	clean = strings.Trim(clean, "-")
	if clean == "" {
		clean = "project"
	}
	if len(clean) > 24 {
		clean = clean[:24]
	}
	return fmt.Sprintf("gritqa-%s-%04x", clean, rand.IntN(1<<16))
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(lines[i]); t != "" {
			return t
		}
	}
	return "no output"
}

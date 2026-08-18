package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Token is the bearer for one request. A static key returns the same string
// forever; a minted one expires and has to be asked for again.
type Token interface {
	Token(ctx context.Context) (string, error)
	// Stale drops a cached value and reports whether asking again is worth it,
	// so a token that expired mid-run is refreshed rather than reported as a
	// bad key.
	Stale() bool
	// String names where the bearer came from, for the message a refusal prints.
	String() string
}

// Static is a key from the environment. It cannot go stale, so a refusal is a
// real refusal.
type Static string

func (s Static) Token(context.Context) (string, error) { return string(s), nil }
func (s Static) Stale() bool                           { return false }
func (s Static) String() string                        { return KeyEnv }

// defaultTTL is well inside the hour Google's tokens last. Nothing depends on
// it being right: an expired token is recovered from either way.
const defaultTTL = 45 * time.Minute

// grace is how recently a mint counts as fresh. Four extraction workers hitting
// the same expiry must mint once between them, not four times.
var grace = 10 * time.Second

// Command mints a bearer by running a command — a gcloud access token, a vault
// read. The value is cached because minting costs about a second, and the
// extraction pass runs four workers.
type Command struct {
	Line string
	TTL  time.Duration

	mu     sync.Mutex
	token  string
	minted time.Time
}

func (c *Command) String() string { return "run.model.token_command" }

func (c *Command) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Since(c.minted) < c.ttl() {
		return c.token, nil
	}

	argv := c.shell()
	out, err := exec.CommandContext(ctx, argv[0], argv[1:]...).Output()
	if err != nil {
		return "", c.failed(err)
	}
	token := strings.TrimSpace(string(out))
	if token == "" {
		return "", fmt.Errorf("run.model.token_command printed no token: %s", c.Line)
	}

	c.token, c.minted = token, time.Now()
	return token, nil
}

func (c *Command) Stale() bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token == "" {
		return false
	}
	// A token minted moments ago came from another worker hitting the same
	// expiry. Retry with theirs instead of replacing it.
	if time.Since(c.minted) < grace {
		return true
	}
	c.token = ""
	return true
}

func (c *Command) ttl() time.Duration {
	if c.TTL > 0 {
		return c.TTL
	}
	return defaultTTL
}

// failed keeps the command's own first line of stderr: "unknown account" is the
// failure a user can act on, and gcloud says it there.
func (c *Command) failed(err error) error {
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		if why := firstLine(exit.Stderr); why != "" {
			return fmt.Errorf("could not mint a model token with %q: %s", c.Line, why)
		}
	}
	return fmt.Errorf("could not mint a model token with %q: %w", c.Line, err)
}

func firstLine(b []byte) string {
	for _, line := range bytes.Split(b, []byte("\n")) {
		if s := strings.TrimSpace(string(line)); s != "" {
			return s
		}
	}
	return ""
}

func (c *Command) shell() []string {
	if runtime.GOOS == "windows" {
		return []string{"cmd", "/c", c.Line}
	}
	return []string{"sh", "-c", c.Line}
}

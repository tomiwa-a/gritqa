package sandbox

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Command is one line from run.migrate or run.seed, run as written so a project's
// own tooling is what touches its schema. Nothing runs inside the container: the
// database image has no PHP, no composer and no ruby, which is also why nothing
// here needs a shell tool.
type Command struct {
	Label string
	Line  string
}

// Step is one command as it went, for the transcript.
type Step struct {
	Label   string
	Elapsed time.Duration
}

// Prepare runs the project's migrations and seeders against the sandbox, from the
// project root, with the sandbox's own DB_* exported. extra is run.env, which the
// user set and which loses to the sandbox on a name they share.
func (s *Sandbox) Prepare(ctx context.Context, root string, cmds []Command, extra map[string]string) ([]Step, error) {
	out := make([]Step, 0, len(cmds))
	for _, c := range cmds {
		if strings.TrimSpace(c.Line) == "" {
			continue
		}
		s.log(c.Label + "…")
		started := time.Now()
		if err := s.shell(ctx, root, c.Line, extra); err != nil {
			return out, fmt.Errorf("%s failed: %w", c.Label, err)
		}
		out = append(out, Step{Label: c.Label, Elapsed: time.Since(started)})
	}
	if len(out) == 0 {
		return out, nil
	}

	// The schema only exists now, so what the ledger watches is worked out here
	// rather than at Up, where the database was empty.
	units, err := s.discover(ctx, s.only)
	if err != nil {
		return out, err
	}
	s.units = units

	if len(units) == 0 {
		return out, fmt.Errorf("%s reported success and the sandbox is still empty, "+
			"so it migrated something else — check that it reads DB_HOST and DB_NAME from the "+
			"environment (a PHP project that loads .env with phpdotenv needs "+
			"php -d variables_order=EGPCS, or $_ENV is never populated and it falls back to its "+
			"own default)", out[0].Label)
	}
	return out, nil
}

func (s *Sandbox) shell(ctx context.Context, dir, line string, extra map[string]string) error {
	name, flag := "sh", "-c"
	if runtime.GOOS == "windows" {
		name, flag = "cmd", "/c"
	}
	cmd := exec.CommandContext(ctx, name, flag, line)
	cmd.Dir = dir
	cmd.Env = s.environ(extra)

	out, err := cmd.CombinedOutput()
	if err != nil {
		if ce := ctx.Err(); ce != nil {
			return ce
		}
		text := s.creds.scrub(strings.TrimSpace(string(out)))
		if text == "" {
			return err
		}
		return fmt.Errorf("%w — %s", err, lastLine(text))
	}
	return nil
}

// environ puts the sandbox last, so a DB_HOST the user configured cannot point a
// migration at their real database by accident.
func (s *Sandbox) environ(extra map[string]string) []string {
	env := os.Environ()
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	for k, v := range s.Env() {
		env = append(env, k+"="+v)
	}
	return env
}

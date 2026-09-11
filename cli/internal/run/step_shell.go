package run

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

// shellStep runs a shell command inside the sandbox container -- the setup no API
// exposes: a migration, a cache clear, a seeder reading a fixture file.
//
// A non-zero exit is not an error here. It is the answer, and `exitCode` is an
// assertion type precisely so a plan can say what it expects: a command that is
// supposed to fail can assert that it did. An error is a command that could not be
// run at all.
func (e *Engine) shellStep(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
	out := StepResult{ID: s.ID, Name: s.Label()}

	if e.ShellExec == nil {
		out.Status, out.Err = StepError, "no sandbox container available for shell steps"
		return out
	}

	cmd, err := Text(s.Action.Command, vars)
	if err != nil {
		out.Status, out.Err = StepError, err.Error()
		return out
	}
	// The interpolated command is what actually ran, which makes it this step's
	// answer to "what went over the wire" -- masked, because a command line can
	// carry a credential the same way a URL can.
	out.URL = e.mask(cmd)

	attempts, delay := s.Attempts()
	for i := 1; i <= attempts; i++ {
		if i > 1 && delay > 0 {
			select {
			case <-ctx.Done():
				out.Status, out.Err = StepError, ctx.Err().Error()
				return out
			case <-time.After(time.Duration(delay) * time.Millisecond):
			}
		}
		out.Attempts = i

		started := time.Now()
		stdout, stderr, code, err := e.ShellExec(ctx, cmd)
		out.Elapsed = time.Since(started)
		// Masked before it is stored, not before it is printed: Stdout travels to
		// the dashboard and into a repair prompt, and a command echoing an env
		// var would otherwise write a configured credential into both.
		out.Stdout, out.ExitCode = e.mask(stdout), code
		stderr = e.mask(stderr)

		if err != nil {
			out.Status, out.Err = StepError, fmt.Sprintf("shell: %s", e.mask(err.Error()))
			continue
		}

		syn := &Response{
			Status:  200,
			Elapsed: out.Elapsed,
			JSON: map[string]any{
				"exitCode":  code,
				"stdout":    out.Stdout,
				"stderr":    stderr,
				"lineCount": countLines(out.Stdout),
			},
		}

		checks, err := Assert(s.Assertions, syn, vars)
		out.Checks = checks
		if err != nil {
			out.Status, out.Err = StepError, err.Error()
			continue
		}
		if !allPassed(checks) {
			out.Status = StepFailed
			// A command that failed usually says why on stderr, and a plan that
			// only asserted on the exit code would otherwise report a number
			// with no reason beside it.
			if out.Err == "" && stderr != "" {
				out.Err = lastLine(stderr)
			}
			continue
		}

		if err := Extract(s.Extract, syn, vars); err != nil {
			out.Status, out.Err = StepError, err.Error()
			return out
		}
		out.Status = StepPassed
		return out
	}
	return out
}

func countLines(s string) int {
	if s == "" {
		return 0
	}
	n := strings.Count(s, "\n")
	if !strings.HasSuffix(s, "\n") {
		n++
	}
	return n
}

// lastLine is the line a reader would have looked at: commands put the reason a
// build failed at the bottom, under the noise of it working up to that point.
func lastLine(s string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

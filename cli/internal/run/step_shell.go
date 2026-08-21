package run

import (
	"context"
	"fmt"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

// shellStep runs a shell command in the sandbox container. It interpolates the
// command, executes it, and captures stdout and the exit code.
func (e *Engine) shellStep(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
	out := StepResult{ID: s.ID, Name: s.Label()}

	if e.ShellExec == nil {
		out.Status, out.Err = StepError, "no shell exec available for shell steps"
		return out
	}

	cmd, err := Text(s.Action.Command, vars)
	if err != nil {
		out.Status, out.Err = StepError, err.Error()
		return out
	}

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
		stdout, exitCode, err := e.ShellExec(ctx, cmd)
		out.Elapsed = time.Since(started)
		out.Stdout = stdout
		out.ExitCode = exitCode

		if err != nil {
			out.Status, out.Err = StepError, fmt.Sprintf("shell: %s", err)
			continue
		}

		// Build a minimal response for assertions. "status" is 200 when the
		// command runs; "bodyField" paths resolve against a synthetic JSON
		// object carrying stdout, exit code, and line count.
		lines := 0
		if stdout != "" {
			lines = countLines(stdout)
		}
		syn := &Response{
			Status:  200,
			Elapsed: out.Elapsed,
			JSON: map[string]any{
				"exitCode":  exitCode,
				"stdout":    stdout,
				"lineCount": lines,
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
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			n++
		}
	}
	if len(s) > 0 && s[len(s)-1] != '\n' {
		n++
	}
	return n
}

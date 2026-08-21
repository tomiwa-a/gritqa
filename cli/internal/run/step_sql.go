package run

import (
	"context"
	"fmt"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

// sqlStep runs a SQL step against the sandbox database. It interpolates the
// statement, executes it, and captures rows affected and any single-value result.
func (e *Engine) sqlStep(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
	out := StepResult{ID: s.ID, Name: s.Label()}

	if e.SandboxDB == nil {
		out.Status, out.Err = StepError, "no sandbox database available for sql steps"
		return out
	}

	stmt, err := Text(s.Action.Statement, vars)
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
		res, err := e.SandboxDB.ExecContext(ctx, stmt)
		if err != nil {
			out.Status, out.Err = StepError, fmt.Sprintf("sql: %s", err)
			continue
		}
		out.Elapsed = time.Since(started)

		affected, _ := res.RowsAffected()
		out.RowsAffected = affected

		// Build a minimal response for assertions. The "status" for SQL is 200
		// when the query succeeds; "bodyField" paths resolve against a synthetic
		// JSON object carrying the row count and affected rows.
		syn := &Response{
			Status:  200,
			Elapsed: out.Elapsed,
			JSON: map[string]any{
				"rowsAffected": affected,
				"rowCount":     affected,
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

		// SQL extraction: result source reads from the synthetic JSON, body
		// source works the same way.
		if err := Extract(s.Extract, syn, vars); err != nil {
			out.Status, out.Err = StepError, err.Error()
			return out
		}
		out.Status = StepPassed
		return out
	}
	return out
}

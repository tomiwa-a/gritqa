package run

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

// sqlStep runs a SQL step against the sandbox database -- GritQA's own copy of it,
// never the developer's.
//
// The step's target decides how it runs, and that difference is the whole point of
// having two. A `setup` step executes: it is there to put a row where the next
// request needs one, and what matters afterwards is how many rows moved. A `verify`
// step queries: it exists because a 201 is not evidence that anything was written,
// and the rows it comes back with are that evidence.
//
// Running both through Exec, which is what this did first, made the second kind
// impossible. MySQL reports no rows affected for a SELECT, so `rowCount` on a
// verification query was always 0 -- an assertion that could not fail, on the one
// question the feature exists to answer.
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
	// The interpolated statement is what actually ran, which makes it the sql
	// step's answer to "what went over the wire" -- masked, because a fixture can
	// carry a credential the same way a URL can.
	out.URL = e.mask(stmt)

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
		syn, rows, err := e.runStatement(ctx, s.Action.Target, stmt)
		out.Elapsed = time.Since(started)
		if err != nil {
			out.Status, out.Err = StepError, fmt.Sprintf("sql: %s", e.mask(err.Error()))
			continue
		}
		out.RowsAffected = rows
		out.Body = body(syn.JSON, e.mask)
		syn.Elapsed = out.Elapsed

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

// body is a sql step's rows as a reporter reads them. The count alone says a row
// exists; only this says which one, which is the evidence a verify step is for.
// Masked, because a statement can carry a credential the same way a URL can.
func body(v any, mask func(string) string) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return []byte(mask(string(b)))
}

// runStatement executes or queries, and builds the synthetic response the
// assertions read.
//
// `rowCount` means the same thing either way -- how many rows this statement is
// answerable for -- so a plan can assert on it without knowing which branch ran.
// Only `verify` carries `rows`, because only a query has any.
func (e *Engine) runStatement(ctx context.Context, target plan.Target, stmt string) (*Response, int64, error) {
	if target != plan.Verify {
		res, err := e.SandboxDB.ExecContext(ctx, stmt)
		if err != nil {
			return nil, 0, err
		}
		affected, _ := res.RowsAffected()
		return &Response{Status: 200, JSON: map[string]any{
			"rowsAffected": affected,
			"rowCount":     affected,
		}}, affected, nil
	}

	found, err := query(ctx, e.SandboxDB, stmt)
	if err != nil {
		return nil, 0, err
	}
	syn := map[string]any{"rowCount": int64(len(found)), "rows": found}
	// `row` beside `rows` so the common assertion reads as what it is: one query,
	// one number, `row.total` rather than `rows[0].total`.
	if len(found) > 0 {
		syn["row"] = found[0]
	}
	return &Response{Status: 200, JSON: syn}, int64(len(found)), nil
}

// query reads a result set into the shape Value walks: a []any of objects, keyed
// by column name.
//
// Every value becomes a string, because the driver hands back []byte for most
// column types and compare() normalises to text anyway. A column that came back
// NULL is nil rather than "", so `exists` can tell the two apart.
func query(ctx context.Context, db *sql.DB, stmt string) ([]any, error) {
	rows, err := db.QueryContext(ctx, stmt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	out := []any{}
	for rows.Next() {
		if len(out) >= maxSQLRows {
			break
		}
		cells := make([]any, len(cols))
		into := make([]any, len(cols))
		for i := range cells {
			into[i] = &cells[i]
		}
		if err := rows.Scan(into...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, name := range cols {
			row[name] = cell(cells[i])
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// maxSQLRows is where a verification query stops being read. A plan asserting on
// row four hundred is asserting on something else, and the rows travel to the
// dashboard as part of the result.
const maxSQLRows = 200

func cell(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case []byte:
		return string(t)
	case time.Time:
		return t.Format(time.RFC3339)
	}
	return v
}

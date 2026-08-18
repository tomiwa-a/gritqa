package index

import (
	"database/sql"
	"time"
)

// history is not a cache. It survives a schema mismatch, because until the
// server lands there is nowhere else a user's runs exist.
const history = `
CREATE TABLE IF NOT EXISTS executions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan        TEXT NOT NULL,
  plan_file   TEXT NOT NULL,
  status      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  started_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_results (
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  step_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  code         INTEGER,
  duration_ms  INTEGER,
  detail       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (execution_id, seq)
);
`

// Execution is one run as history keeps it, in the shape M4's server ingests.
type Execution struct {
	ID        int64
	Plan      string
	PlanFile  string
	Status    string
	Duration  time.Duration
	StartedAt time.Time
	Steps     []StepRow
}

// StepRow is one step. Code and Duration are zero when the request never
// completed, which is the UI's null.
type StepRow struct {
	StepID   string
	Name     string
	Status   string
	Method   string
	Path     string
	Code     int
	Duration time.Duration
	Detail   string
}

func (s *Store) SaveExecution(e *Execution) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO executions (plan, plan_file, status, duration_ms, started_at)
		 VALUES (?, ?, ?, ?, ?)`,
		e.Plan, e.PlanFile, e.Status, e.Duration.Milliseconds(),
		e.StartedAt.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	insert, err := tx.Prepare(
		`INSERT INTO step_results
		   (execution_id, seq, step_id, name, status, method, path, code, duration_ms, detail)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer insert.Close()

	for i, st := range e.Steps {
		if _, err := insert.Exec(id, i, st.StepID, st.Name, st.Status, st.Method, st.Path,
			nullInt(st.Code), nullInt(int(st.Duration.Milliseconds())), st.Detail); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit()
}

// Executions returns the most recent runs, newest first.
func (s *Store) Executions(limit int) ([]Execution, error) {
	rows, err := s.db.Query(
		`SELECT id, plan, plan_file, status, duration_ms, started_at
		 FROM executions ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Execution
	for rows.Next() {
		var e Execution
		var ms int64
		var started string
		if err := rows.Scan(&e.ID, &e.Plan, &e.PlanFile, &e.Status, &ms, &started); err != nil {
			return nil, err
		}
		e.Duration = time.Duration(ms) * time.Millisecond
		e.StartedAt, _ = time.Parse(time.RFC3339, started)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		if out[i].Steps, err = s.steps(out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) steps(id int64) ([]StepRow, error) {
	rows, err := s.db.Query(
		`SELECT step_id, name, status, method, path, code, duration_ms, detail
		 FROM step_results WHERE execution_id = ? ORDER BY seq`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StepRow
	for rows.Next() {
		var st StepRow
		var code, ms sql.NullInt64
		if err := rows.Scan(&st.StepID, &st.Name, &st.Status, &st.Method, &st.Path,
			&code, &ms, &st.Detail); err != nil {
			return nil, err
		}
		st.Code = int(code.Int64)
		st.Duration = time.Duration(ms.Int64) * time.Millisecond
		out = append(out, st)
	}
	return out, rows.Err()
}

func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

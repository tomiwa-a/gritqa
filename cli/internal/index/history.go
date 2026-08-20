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

CREATE TABLE IF NOT EXISTS plan_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step_id      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  author       TEXT NOT NULL,
  instruction  TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL,
  accepted     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_state (
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  unit         TEXT NOT NULL,
  rows_moved   INTEGER NOT NULL,
  from_value   TEXT NOT NULL DEFAULT '',
  to_value     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (execution_id, seq)
);

CREATE TABLE IF NOT EXISTS plan_changes (
  revision_id INTEGER NOT NULL REFERENCES plan_revisions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  step_name   TEXT NOT NULL,
  detail      TEXT NOT NULL,
  from_value  TEXT NOT NULL DEFAULT '',
  to_value    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (revision_id, seq)
);
`

// added is a column history gained after a user's cache already existed. The
// tables use CREATE TABLE IF NOT EXISTS, which cannot add to one that is there.
var added = []struct{ table, column, decl string }{
	{"step_results", "verdict", "TEXT NOT NULL DEFAULT 'undecided'"},
	{"executions", "confirmed", "INTEGER"},
	{"executions", "confirm_note", "TEXT NOT NULL DEFAULT ''"},
	{"step_results", "moved", "TEXT NOT NULL DEFAULT ''"},
	{"executions", "state_note", "TEXT NOT NULL DEFAULT ''"},
}

// upgrade adds those columns to a cache that predates them. A run that cannot be
// upgraded is reported by whoever writes it, not silenced here.
func upgrade(db *sql.DB) error {
	for _, c := range added {
		has, err := hasColumn(db, c.table, c.column)
		if err != nil {
			return err
		}
		if has {
			continue
		}
		if _, err := db.Exec("ALTER TABLE " + c.table + " ADD COLUMN " + c.column + " " + c.decl); err != nil {
			return err
		}
	}
	return nil
}

func hasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query("SELECT name FROM pragma_table_info(?)", table)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Execution is one run as history keeps it, in the shape M4's server ingests.
type Execution struct {
	ID        int64
	Plan      string
	PlanFile  string
	Status    string
	Duration  time.Duration
	StartedAt time.Time
	Steps     []StepRow
	// Confirmed is null until a confirm pass ran. It never decides the run's
	// status: the deterministic engine owns that.
	Confirmed   sql.NullBool
	ConfirmNote string
	Revisions   []Revision
	// Moved is the run's state ledger: what the database looked like after,
	// against before the first step. Empty for a run with no sandbox watching.
	Moved []MovedRow
	// StateNote is why the ledger is incomplete, when it is. It never decides the
	// run's status.
	StateNote string
}

// MovedRow is one unit that changed over a run. Rows is signed: a delete moving
// a count down is as much a finding as an insert moving it up.
type MovedRow struct {
	Unit string
	Rows int64
	From string
	To   string
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
	// Moved is what this step changed, rendered. Empty for a step that changed
	// nothing, which for a POST is a finding of its own.
	Moved string
	// Verdict is the human's call on a failure — real_bug, bad_test or undecided.
	// It is the one thing a machine cannot work out.
	Verdict string
}

// Revision is one repair attempt as history keeps it. Accepted is false when
// Allowed refused the edit, which is worth keeping: a repairer reaching for a
// frozen field is the failure mode the guard exists for.
type Revision struct {
	StepID      string
	Version     int
	Author      string
	Instruction string
	Summary     string
	Accepted    bool
	Changes     []ChangeRow
}

type ChangeRow struct {
	Kind     string
	StepName string
	Detail   string
	From     string
	To       string
}

func (s *Store) SaveExecution(e *Execution) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO executions
		   (plan, plan_file, status, duration_ms, started_at, confirmed, confirm_note, state_note)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Plan, e.PlanFile, e.Status, e.Duration.Milliseconds(),
		e.StartedAt.UTC().Format(time.RFC3339), e.Confirmed, e.ConfirmNote, e.StateNote)
	if err != nil {
		return 0, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	insert, err := tx.Prepare(
		`INSERT INTO step_results
		   (execution_id, seq, step_id, name, status, method, path, code, duration_ms, detail,
		    verdict, moved)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer insert.Close()

	for i, st := range e.Steps {
		if _, err := insert.Exec(id, i, st.StepID, st.Name, st.Status, st.Method, st.Path,
			nullInt(st.Code), nullInt(int(st.Duration.Milliseconds())), st.Detail,
			orUndecided(st.Verdict), st.Moved); err != nil {
			return 0, err
		}
	}

	for i, m := range e.Moved {
		if _, err := tx.Exec(
			`INSERT INTO execution_state (execution_id, seq, unit, rows_moved, from_value, to_value)
			 VALUES (?, ?, ?, ?, ?, ?)`, id, i, m.Unit, m.Rows, m.From, m.To); err != nil {
			return 0, err
		}
	}

	if err := saveRevisions(tx, id, e.Revisions); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

// Moved returns one run's state ledger, in the order it was recorded.
func (s *Store) Moved(executionID int64) ([]MovedRow, error) {
	rows, err := s.db.Query(
		`SELECT unit, rows_moved, from_value, to_value
		 FROM execution_state WHERE execution_id = ? ORDER BY seq`, executionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MovedRow
	for rows.Next() {
		var m MovedRow
		if err := rows.Scan(&m.Unit, &m.Rows, &m.From, &m.To); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func saveRevisions(tx *sql.Tx, id int64, revs []Revision) error {
	for _, r := range revs {
		res, err := tx.Exec(
			`INSERT INTO plan_revisions
			   (execution_id, step_id, version, author, instruction, summary, accepted)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, r.StepID, r.Version, r.Author, r.Instruction, r.Summary, r.Accepted)
		if err != nil {
			return err
		}
		rid, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for i, c := range r.Changes {
			if _, err := tx.Exec(
				`INSERT INTO plan_changes (revision_id, seq, kind, step_name, detail, from_value, to_value)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				rid, i, c.Kind, c.StepName, c.Detail, c.From, c.To); err != nil {
				return err
			}
		}
	}
	return nil
}

// Revisions returns the repair attempts recorded for one run, oldest first.
func (s *Store) Revisions(executionID int64) ([]Revision, error) {
	rows, err := s.db.Query(
		`SELECT id, step_id, version, author, instruction, summary, accepted
		 FROM plan_revisions WHERE execution_id = ? ORDER BY id`, executionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Revision
	var ids []int64
	for rows.Next() {
		var r Revision
		var id int64
		if err := rows.Scan(&id, &r.StepID, &r.Version, &r.Author,
			&r.Instruction, &r.Summary, &r.Accepted); err != nil {
			return nil, err
		}
		out = append(out, r)
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i, id := range ids {
		if out[i].Changes, err = s.changes(id); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) changes(revisionID int64) ([]ChangeRow, error) {
	rows, err := s.db.Query(
		`SELECT kind, step_name, detail, from_value, to_value
		 FROM plan_changes WHERE revision_id = ? ORDER BY seq`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ChangeRow
	for rows.Next() {
		var c ChangeRow
		if err := rows.Scan(&c.Kind, &c.StepName, &c.Detail, &c.From, &c.To); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Executions returns the most recent runs, newest first.
func (s *Store) Executions(limit int) ([]Execution, error) {
	rows, err := s.db.Query(
		`SELECT id, plan, plan_file, status, duration_ms, started_at, confirmed, confirm_note,
		        state_note
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
		if err := rows.Scan(&e.ID, &e.Plan, &e.PlanFile, &e.Status, &ms, &started,
			&e.Confirmed, &e.ConfirmNote, &e.StateNote); err != nil {
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
		if out[i].Moved, err = s.Moved(out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) steps(id int64) ([]StepRow, error) {
	rows, err := s.db.Query(
		`SELECT step_id, name, status, method, path, code, duration_ms, detail, verdict, moved
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
			&code, &ms, &st.Detail, &st.Verdict, &st.Moved); err != nil {
			return nil, err
		}
		st.Code = int(code.Int64)
		st.Duration = time.Duration(ms.Int64) * time.Millisecond
		out = append(out, st)
	}
	return out, rows.Err()
}

func orUndecided(v string) string {
	if v == "" {
		return "undecided"
	}
	return v
}

func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

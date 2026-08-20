package sandbox

import (
	"context"
	"database/sql"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/run"
)

// unit is one thing worth watching and how to watch it, worked out once from the
// schema GritQA itself migrated.
type unit struct {
	table string
	key   string // high-water column, empty when the table can only be counted
}

// Watermark is one reading: how many rows each unit holds and how far its key has
// got. It is deliberately not a consistent snapshot — a delta across one step is
// what the product needs, and a snapshot would mean holding a transaction open,
// which under InnoDB's default isolation makes every subsequent delta zero.
type Watermark struct {
	At    time.Time
	Units []Row
}

type Row struct {
	Name string
	Rows int64
	// High is the key's maximum, empty when the unit is count-only or empty.
	High string
	// CountOnly is true for a table with no orderable key — a UUID primary key
	// has no MAX worth reading, so the count is all there is.
	CountOnly bool
}

// discover works out what to watch. Views are skipped; a table named in
// Options.Tables wins over the schema's own list.
func (s *Sandbox) discover(ctx context.Context, only []string) ([]unit, error) {
	tables, err := s.baseTables(ctx)
	if err != nil {
		return nil, err
	}
	if len(only) > 0 {
		want := make(map[string]bool, len(only))
		for _, t := range only {
			want[t] = true
		}
		kept := tables[:0]
		for _, t := range tables {
			if want[t] {
				kept = append(kept, t)
			}
		}
		tables = kept
	}

	keys, err := s.keys(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]unit, 0, len(tables))
	for _, t := range tables {
		out = append(out, unit{table: t, key: keys[t]})
	}
	return out, nil
}

func (s *Sandbox) baseTables(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT TABLE_NAME FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
		s.creds.Database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		if safeIdent(t) {
			out = append(out, t)
		}
	}
	return out, rows.Err()
}

// keys picks each table's high-water column: an auto-increment first, then a
// single integer primary key, then a timestamp. Anything else is count-only.
func (s *Sandbox) keys(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, EXTRA, COLUMN_KEY
		 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
		 ORDER BY TABLE_NAME, ORDINAL_POSITION`, s.creds.Database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type pick struct {
		col  string
		rank int
	}
	best := map[string]pick{}
	for rows.Next() {
		var table, col, dtype, extra, ckey string
		if err := rows.Scan(&table, &col, &dtype, &extra, &ckey); err != nil {
			return nil, err
		}
		if !safeIdent(col) {
			continue
		}
		r := rank(col, dtype, extra, ckey)
		if r == 0 {
			continue
		}
		if got, ok := best[table]; !ok || r > got.rank {
			best[table] = pick{col: col, rank: r}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make(map[string]string, len(best))
	for t, p := range best {
		out[t] = p.col
	}
	return out, nil
}

func rank(col, dtype, extra, ckey string) int {
	switch {
	case strings.Contains(strings.ToLower(extra), "auto_increment"):
		return 3
	case ckey == "PRI" && integerType(dtype):
		return 2
	case temporalType(dtype) && (col == "created_at" || col == "updated_at" || strings.HasSuffix(col, "_at")):
		return 1
	}
	return 0
}

func integerType(t string) bool {
	switch strings.ToLower(t) {
	case "int", "integer", "bigint", "smallint", "mediumint", "tinyint":
		return true
	}
	return false
}

func temporalType(t string) bool {
	switch strings.ToLower(t) {
	case "datetime", "timestamp", "date":
		return true
	}
	return false
}

// Mark satisfies run.State.
func (s *Sandbox) Mark(ctx context.Context) (run.Mark, error) {
	return s.Watermark(ctx)
}

// Watermark reads every unit in one round trip. COUNT(*) rather than
// information_schema.TABLE_ROWS, which is an estimate and would report a delta
// of zero for a handful of inserts.
func (s *Sandbox) Watermark(ctx context.Context) (*Watermark, error) {
	out := &Watermark{At: time.Now()}
	if len(s.units) > 0 {
		rows, err := s.db.QueryContext(ctx, countQuery(s.units))
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		byName := make(map[string]*Row, len(s.units))
		for rows.Next() {
			var name string
			var n int64
			var high sql.NullString
			if err := rows.Scan(&name, &n, &high); err != nil {
				return nil, err
			}
			r := Row{Name: name, Rows: n, High: high.String}
			byName[name] = &r
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		for _, u := range s.units {
			r, ok := byName[u.table]
			if !ok {
				continue
			}
			r.CountOnly = u.key == ""
			out.Units = append(out.Units, *r)
		}
	}

	files, err := s.watchFiles()
	if err != nil {
		return nil, err
	}
	out.Units = append(out.Units, files...)
	return out, nil
}

func countQuery(units []unit) string {
	var b strings.Builder
	for i, u := range units {
		if i > 0 {
			b.WriteString(" UNION ALL ")
		}
		b.WriteString("SELECT ")
		b.WriteString(quote(u.table))
		b.WriteString(" AS u, COUNT(*) AS n, ")
		if u.key == "" {
			b.WriteString("NULL")
		} else {
			b.WriteString("CAST(MAX(`" + u.key + "`) AS CHAR)")
		}
		b.WriteString(" AS hi FROM `" + u.table + "`")
	}
	return b.String()
}

// Watch names directories whose file count is reported alongside the database.
// The sandbox isolates the database, not the filesystem: a run rooted at the real
// project still writes uploads into the user's tree, and this reports that rather
// than pretending it did not happen.
func (s *Sandbox) Watch(dirs ...string) { s.watch = append(s.watch, dirs...) }

func (s *Sandbox) watchFiles() ([]Row, error) {
	out := make([]Row, 0, len(s.watch))
	for _, dir := range s.watch {
		var n int64
		var newest time.Time
		err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			n++
			if info, err := d.Info(); err == nil && info.ModTime().After(newest) {
				newest = info.ModTime()
			}
			return nil
		})
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		r := Row{Name: "files:" + filepath.Base(dir), Rows: n}
		if !newest.IsZero() {
			r.High = newest.UTC().Format(time.RFC3339)
		}
		out = append(out, r)
	}
	return out, nil
}

// Diff satisfies run.Mark. A unit absent from the earlier reading is compared
// against zero, so a table a migration added mid-run still reports its rows.
func (w *Watermark) Diff(before run.Mark) []run.Moved {
	prev, ok := before.(*Watermark)
	if !ok || prev == nil {
		return nil
	}
	was := make(map[string]Row, len(prev.Units))
	for _, r := range prev.Units {
		was[r.Name] = r
	}

	var out []run.Moved
	for _, now := range w.Units {
		old := was[now.Name]
		rows := now.Rows - old.Rows
		if rows == 0 && now.High == old.High {
			continue
		}
		m := run.Moved{Unit: now.Name, Rows: rows}
		if !now.CountOnly {
			m.From, m.To = old.High, now.High
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		if abs(out[i].Rows) != abs(out[j].Rows) {
			return abs(out[i].Rows) > abs(out[j].Rows)
		}
		return out[i].Unit < out[j].Unit
	})
	return out
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// Tables is the schema as GritQA knows it, for the describe_schema tool M5 adds.
func (s *Sandbox) Tables() []string {
	out := make([]string, 0, len(s.units))
	for _, u := range s.units {
		out = append(out, u.table)
	}
	return out
}

// safeIdent refuses anything that could not be quoted with backticks. The names
// come from information_schema, but db(sql) will let an agent create tables and
// a name it chose is not something to interpolate on trust.
func safeIdent(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if r == '`' || r == 0 || r < 0x20 {
			return false
		}
	}
	return true
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

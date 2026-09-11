package index

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/index/golang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/index/source"

	_ "modernc.org/sqlite"
)

// schemaVersion guards the cache. It is only a cache, so a mismatch rebuilds
// rather than migrates.
const schemaVersion = "4"

const schema = `
CREATE TABLE files (
  path       TEXT PRIMARY KEY,
  language   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  hash       TEXT NOT NULL,
  symbols    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE routes (
  file       TEXT NOT NULL,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  line       INTEGER NOT NULL,
  handler    TEXT NOT NULL,
  middleware TEXT NOT NULL DEFAULT '[]',
  unresolved INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (file, method, path)
);

-- One model extraction per file version, so an unchanged file is free. hash is
-- the cache key, which covers the gateway sent with the file; file_hash is the
-- version it belongs to, and the only thing the pruner can judge it by.
CREATE TABLE extractions (
  hash       TEXT PRIMARY KEY,
  file_hash  TEXT NOT NULL,
  endpoints  TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	dsn := "file:" + url.PathEscape(path) +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	if err := s.rebuildCache(); err != nil {
		return err
	}
	if _, err := s.db.Exec(history); err != nil {
		return err
	}
	return upgrade(s.db)
}

// rebuildCache drops and recreates the cache tables when the schema moved. Run
// history is deliberately not among them.
func (s *Store) rebuildCache() error {
	var have string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'schema_version'`).Scan(&have)
	if err == nil && have == schemaVersion {
		return nil
	}

	for _, t := range []string{"files", "routes", "extractions", "meta"} {
		if _, err := s.db.Exec(`DROP TABLE IF EXISTS ` + t); err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	return s.SetMeta("schema_version", schemaVersion)
}

// Hashes returns the previous index's path→hash map, empty on a first run.
func (s *Store) Hashes() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT path, hash FROM files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var path, hash string
		if err := rows.Scan(&path, &hash); err != nil {
			return nil, err
		}
		out[path] = hash
	}
	return out, rows.Err()
}

// Save replaces the cache with a whole snapshot. A full rewrite is cheap at this
// size and cannot leave the two tables disagreeing.
func (s *Store) Save(snap *Snapshot) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM files`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM routes`); err != nil {
		return err
	}

	insertFile, err := tx.Prepare(`INSERT INTO files (path, language, size, hash, symbols) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insertFile.Close()

	for _, f := range snap.Files {
		syms, err := json.Marshal(f.Symbols)
		if err != nil {
			return err
		}
		if _, err := insertFile.Exec(f.Path, f.Language, f.Size, f.Hash, string(syms)); err != nil {
			return fmt.Errorf("cache %s: %w", f.Path, err)
		}
	}

	insertRoute, err := tx.Prepare(
		`INSERT OR REPLACE INTO routes (file, method, path, line, handler, middleware, unresolved, seq)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insertRoute.Close()

	seq := 0
	for _, set := range []struct {
		unresolved int
		rs         []routes.Route
	}{{0, snap.Routes}, {1, snap.Unresolved}} {
		for _, r := range set.rs {
			mw, err := json.Marshal(r.Middleware)
			if err != nil {
				return err
			}
			if _, err := insertRoute.Exec(
				r.File, r.Method, r.Path, r.Line, r.Handler, string(mw), set.unresolved, seq,
			); err != nil {
				return fmt.Errorf("cache %s: %w", r.Signature(), err)
			}
			seq++
		}
	}

	if _, err := tx.Exec(
		`DELETE FROM extractions WHERE file_hash NOT IN (SELECT hash FROM files)`); err != nil {
		return err
	}

	for k, v := range map[string]string{
		"indexed_at":    time.Now().UTC().Format(time.RFC3339),
		"source":        string(snap.Source),
		"source_detail": snap.SourceDetail,
		"frameworks":    joinIDs(snap.Frameworks),
	} {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Load rebuilds the last snapshot, so an unchanged tree needs no reparsing.
func (s *Store) Load(root string) (*Snapshot, error) {
	snap := &Snapshot{Root: root}

	rows, err := s.db.Query(`SELECT path, language, size, hash, symbols FROM files ORDER BY path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var f File
		var syms string
		if err := rows.Scan(&f.Path, &f.Language, &f.Size, &f.Hash, &syms); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(syms), &f.Symbols); err != nil {
			f.Symbols = map[golang.SymbolKind]int{}
		}
		snap.Files = append(snap.Files, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rs, err := s.db.Query(
		`SELECT file, method, path, line, handler, middleware, unresolved FROM routes ORDER BY seq`)
	if err != nil {
		return nil, err
	}
	defer rs.Close()

	for rs.Next() {
		var r routes.Route
		var mw string
		var unresolved bool
		if err := rs.Scan(&r.File, &r.Method, &r.Path, &r.Line, &r.Handler, &mw, &unresolved); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(mw), &r.Middleware); err != nil {
			r.Middleware = nil
		}
		if unresolved {
			snap.Unresolved = append(snap.Unresolved, r)
			continue
		}
		snap.Routes = append(snap.Routes, r)
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}

	kind, err := s.Meta("source")
	if err != nil {
		return nil, err
	}
	snap.Source = source.Kind(kind)
	if snap.SourceDetail, err = s.Meta("source_detail"); err != nil {
		return nil, err
	}

	fw, err := s.Meta("frameworks")
	if err != nil {
		return nil, err
	}
	snap.Frameworks = splitIDs(fw)
	return snap, nil
}

func (s *Store) Extracted(hash string) ([]routes.Route, bool, error) {
	var raw string
	err := s.db.QueryRow(`SELECT endpoints FROM extractions WHERE hash = ?`, hash).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	var rs []routes.Route
	if err := json.Unmarshal([]byte(raw), &rs); err != nil {
		return nil, false, nil
	}
	return rs, true, nil
}

func (s *Store) SaveExtracted(hash, fileHash string, rs []routes.Route) error {
	raw, err := json.Marshal(rs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT OR REPLACE INTO extractions (hash, file_hash, endpoints) VALUES (?, ?, ?)`,
		hash, fileHash, string(raw))
	return err
}

func joinIDs(ids []lang.ID) string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = string(id)
	}
	return strings.Join(out, ",")
}

func splitIDs(s string) []lang.ID {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]lang.ID, len(parts))
	for i, p := range parts {
		out[i] = lang.ID(p)
	}
	return out
}

func (s *Store) Meta(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

func (s *Store) SetMeta(key, value string) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, key, value)
	return err
}

// LastIndexed is the zero time before the first successful index.
func (s *Store) LastIndexed() (time.Time, error) {
	v, err := s.Meta("indexed_at")
	if err != nil || v == "" {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, v)
}

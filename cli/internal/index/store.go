package index

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/gritqa/cli/internal/index/golang"
	"github.com/gritqa/cli/internal/index/routes"

	_ "modernc.org/sqlite"
)

// schemaVersion guards the cache. It is only a cache, so a mismatch rebuilds
// rather than migrates.
const schemaVersion = "1"

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
  seq        INTEGER NOT NULL,
  PRIMARY KEY (file, method, path)
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
	var have string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'schema_version'`).Scan(&have)
	if err == nil && have == schemaVersion {
		return nil
	}

	for _, t := range []string{"files", "routes", "meta"} {
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
		`INSERT OR REPLACE INTO routes (file, method, path, line, handler, middleware, seq)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insertRoute.Close()

	for i, r := range snap.Routes {
		mw, err := json.Marshal(r.Middleware)
		if err != nil {
			return err
		}
		if _, err := insertRoute.Exec(r.File, r.Method, r.Path, r.Line, r.Handler, string(mw), i); err != nil {
			return fmt.Errorf("cache %s: %w", r.Signature(), err)
		}
	}

	if _, err := tx.Exec(
		`INSERT OR REPLACE INTO meta (key, value) VALUES ('indexed_at', ?)`,
		time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return err
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
		`SELECT file, method, path, line, handler, middleware FROM routes ORDER BY seq`)
	if err != nil {
		return nil, err
	}
	defer rs.Close()

	for rs.Next() {
		var r routes.Route
		var mw string
		if err := rs.Scan(&r.File, &r.Method, &r.Path, &r.Line, &r.Handler, &mw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(mw), &r.Middleware); err != nil {
			r.Middleware = nil
		}
		snap.Routes = append(snap.Routes, r)
	}
	return snap, rs.Err()
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

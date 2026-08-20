package sandbox

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Snapshot is the database as it stood after migrate and seed. Execution restores
// it first, so a plan never passes because research created the row it needed.
type Snapshot struct {
	Path  string
	Bytes int64
	At    time.Time
}

// Baseline records the sandbox as it stands after migrate and seed, and Reset
// returns it to that. Execution always runs against a reset, unconditionally:
// research reaches the same database through the read tools, and a plan passing
// because research created the row it needed is the one failure this cannot
// afford to make conditional.
func (s *Sandbox) Baseline(ctx context.Context) error {
	// The baseline is what the ledger measures against, so this is the point that
	// decides what it watches. Discovering at Up instead would watch an empty
	// database and report that nothing ever moved.
	units, err := s.discover(ctx, s.only)
	if err != nil {
		return err
	}
	s.units = units

	snap, err := s.Take(ctx)
	if err != nil {
		return err
	}
	s.baseline = snap
	return nil
}

func (s *Sandbox) Reset(ctx context.Context) error {
	if s.baseline == nil {
		return errors.New("no baseline was taken, so there is nothing to reset to")
	}
	return s.Restore(ctx, s.baseline)
}

// BaselineBytes is the dump's size, for the transcript.
func (s *Sandbox) BaselineBytes() int64 {
	if s.baseline == nil {
		return 0
	}
	return s.baseline.Bytes
}

// Take dumps the schema and its rows. mysqldump runs inside the container and
// reads its password from the .my.cnf planted at Up, so the credential reaches
// neither an argument list nor this process's memory twice.
func (s *Sandbox) Take(ctx context.Context) (*Snapshot, error) {
	if s.img.Driver != MySQL {
		return nil, fmt.Errorf("snapshots are not implemented for %s yet", s.img.Driver)
	}

	path := filepath.Join(s.dir, fmt.Sprintf("snapshot-%d.sql", time.Now().UnixNano()))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var stderr strings.Builder
	cmd := exec.CommandContext(ctx, "docker", "exec", "-u", "root", s.name,
		"mysqldump", "--add-drop-database", "--single-transaction",
		"--routines", "--triggers", "--databases", s.creds.Database)
	cmd.Stdout = f
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Remove(path)
		if ce := ctx.Err(); ce != nil {
			return nil, ce
		}
		return nil, fmt.Errorf("could not snapshot the sandbox: %s",
			s.creds.scrub(lastLine(stderr.String())))
	}

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() == 0 {
		os.Remove(path)
		return nil, errors.New("the snapshot came back empty")
	}
	return &Snapshot{Path: path, Bytes: info.Size(), At: time.Now()}, nil
}

// Restore replays a snapshot, dropping the database first — the dump carries
// DROP DATABASE, which is what makes this a reset rather than a merge. The
// connection pool is rebuilt afterwards, because every pooled connection was
// holding the schema that just went away.
func (s *Sandbox) Restore(ctx context.Context, snap *Snapshot) error {
	if snap == nil {
		return errors.New("there is no snapshot to restore")
	}
	f, err := os.Open(snap.Path)
	if err != nil {
		return err
	}
	defer f.Close()

	var stderr strings.Builder
	cmd := exec.CommandContext(ctx, "docker", "exec", "-i", "-u", "root", s.name, "mysql")
	cmd.Stdin = f
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ce := ctx.Err(); ce != nil {
			return ce
		}
		return fmt.Errorf("could not restore the sandbox: %s",
			s.creds.scrub(lastLine(stderr.String())))
	}
	return s.reconnect(ctx)
}

func (s *Sandbox) reconnect(ctx context.Context) error {
	if s.db != nil {
		s.db.Close()
	}
	db, err := sql.Open(string(s.img.Driver), s.DSN())
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return err
	}
	s.db = db

	units, err := s.discover(ctx, s.only)
	if err != nil {
		return err
	}
	s.units = units
	return nil
}

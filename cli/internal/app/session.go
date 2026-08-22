package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
	"github.com/gritqa/cli/internal/term"
)

// session is what a resident process holds between requests: an open cache, the
// last index, and a sandbox expensive enough to keep. Both --serve and the attach
// loop are one of these, and a run that arrives while one is warm pays for neither
// the boot nor the walk.
type session struct {
	cfg  *config.Config
	opts Options
	w    *term.Writer

	// mu serialises the expensive, once-only things: two concurrent index passes
	// would contend on one SQLite file, and two callers would each bring a sandbox up.
	mu    sync.Mutex
	store *index.Store
	snap  *index.Snapshot
	st    *staged
}

func newSession(cfg *config.Config, opts Options, w *term.Writer) *session {
	return &session{cfg: cfg, opts: opts, w: w}
}

// staged brings the sandbox up for whatever asked for one — start_sandbox, or a
// run — so a resident process costs nothing for a caller that only reads. Callers
// hold mu.
func (s *session) staged(ctx context.Context) (*staged, error) {
	if s.st != nil {
		return s.st, nil
	}
	if !s.cfg.Run.Sandboxed() {
		return nil, errors.New("this project has no run.sandbox, so there is no database to " +
			"reach and nowhere safe to run a plan — set run.sandbox.image in " + config.Name)
	}
	store, snap, err := s.cached(ctx)
	if err != nil {
		return nil, err
	}
	st, err := stage(ctx, s.w, s.cfg, store, snap)
	if err != nil {
		return nil, err
	}
	s.st = st
	return st, nil
}

// cached opens the index cache once and reads whatever the last pass left. It does
// not index: needing a recipe or a sandbox should not cost a walk, and get_index is
// how a client asks for a fresh one. Callers hold mu.
func (s *session) cached(ctx context.Context) (*index.Store, *index.Snapshot, error) {
	if s.store == nil {
		store, err := index.Open(s.cfg.CachePath())
		if err != nil {
			return nil, nil, fmt.Errorf("could not open the index cache: %w", err)
		}
		s.store = store
	}
	if s.snap == nil {
		if snap, err := s.store.Load(s.cfg.Root()); err == nil {
			s.snap = snap
		}
	}
	if s.snap == nil {
		got, err := read(ctx, s.w, s.cfg, s.opts)
		if err != nil {
			return nil, nil, err
		}
		s.snap = got.snap
	}
	return s.store, s.snap, nil
}

func (s *session) close(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.st.close(ctx)
	s.st = nil
	if s.store != nil {
		s.store.Close()
		s.store = nil
	}
}

// prepared is where a plan is about to run: a sandbox restored to its baseline, or
// the API the config points at.
type prepared struct {
	base      string
	container string
	box       *sandbox.Sandbox
	vars      map[string]string
	secrets   []string
}

// prepare is runPlan's fork, for a plan that arrived over the wire rather than off
// disk. Variables are resolved before anything is brought up: a missing password is
// a cheap failure and pulling an image first would make it an expensive one.
func (s *session) prepare(ctx context.Context, p *plan.Plan) (prepared, error) {
	vars := s.cfg.Run.ResolvedVariables()
	if len(vars.Missing) > 0 {
		return prepared{}, fmt.Errorf("run.variables reads %s from the environment, and there is nothing there",
			strings.Join(vars.Missing, ", "))
	}

	if !s.cfg.Run.Sandboxed() {
		base, err := baseURL(s.w, s.cfg, p)
		if err != nil {
			return prepared{}, err
		}
		if err := probe(ctx, s.cfg, base); err != nil {
			return prepared{}, err
		}
		return prepared{base: base, vars: vars.Values, secrets: secrets(vars, nil)}, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	st, err := s.staged(ctx)
	if err != nil {
		return prepared{}, err
	}
	if err := st.reset(ctx, s.w); err != nil {
		return prepared{}, err
	}
	return prepared{
		base:      st.base,
		container: st.app.Container(),
		box:       st.box,
		vars:      vars.Values,
		secrets:   secrets(vars, st),
	}, nil
}

// engine builds the walk. State is assigned only when there is a sandbox to
// observe: a nil *Sandbox in that interface field would be a non-nil State that
// takes a reading from nothing.
func (p prepared) engine(onStep func(run.StepResult)) *run.Engine {
	e := &run.Engine{
		BaseURL:   p.base,
		Variables: p.vars,
		Secrets:   p.secrets,
		OnStep:    onStep,
	}
	if p.box != nil {
		e.State = p.box
		e.SandboxDB = p.box.DB()
		e.ShellExec = p.box.ShellExec
	}
	return e
}

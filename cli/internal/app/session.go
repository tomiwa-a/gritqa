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
	st    *sandbox.Stack
}

func newSession(cfg *config.Config, opts Options, w *term.Writer) *session {
	return &session{cfg: cfg, opts: opts, w: w}
}

// staged brings the copy up for whatever asked for one — start_sandbox, or a run
// — so a resident process costs nothing for a caller that only reads. Callers
// hold mu.
func (s *session) staged(ctx context.Context) (*sandbox.Stack, error) {
	if s.st != nil {
		return s.st, nil
	}
	if !s.cfg.Run.Sandboxed() {
		return nil, errors.New("this project has no run.sandbox, so nothing brings a copy of it " +
			"up and there is nowhere safe to run a plan — add run.sandbox in " + config.Name)
	}
	store, _, err := s.cached(ctx)
	if err != nil {
		return nil, err
	}
	st, err := stage(ctx, s.w, s.cfg, store)
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

	s.st.Down(ctx)
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
	stack     *sandbox.Stack
	vars      map[string]string
	secrets   []string
}

// prepare is runPlan's fork, for a plan that arrived over the wire rather than off
// disk. Variables are resolved before anything is brought up: a missing password is
// a cheap failure and pulling an image first would make it an expensive one.
func (s *session) prepare(ctx context.Context, p *plan.Plan) (prepared, error) {
	vars := s.cfg.Run.ResolvedVariables()
	if missing := unset(p, vars.Missing); len(missing) > 0 {
		return prepared{}, fmt.Errorf("run.variables reads %s from the environment, and there is nothing there",
			strings.Join(missing, ", "))
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
	if err := reset(ctx, s.w, st); err != nil {
		return prepared{}, err
	}
	return prepared{
		base:      st.BaseURL(),
		container: st.Project(),
		stack:     st,
		vars:      vars.Values,
		secrets:   secrets(vars, st),
	}, nil
}

// unset narrows the missing set to what this plan actually reads. Refusing on all of
// them made one stale mapping enough to stop every plan on the machine, including the
// ones that never wanted the credential; a plan that does read it still fails here,
// which is the cheap failure the check exists for.
func unset(p *plan.Plan, missing []string) []string {
	if len(missing) == 0 {
		return nil
	}
	reads := p.References()
	var out []string
	for _, entry := range missing {
		// Entries read "name ($ENV)", because naming the environment variable is what
		// tells the user what to fix. Only the name is what a plan can reference.
		name, _, _ := strings.Cut(entry, " ")
		if reads[name] {
			out = append(out, entry)
		}
	}
	return out
}

// engine builds the walk. State is assigned only when there is a copy to observe:
// a nil *Stack in that interface field would be a non-nil State that takes a
// reading from nothing.
func (p prepared) engine(onStep func(run.StepResult)) *run.Engine {
	e := &run.Engine{
		BaseURL:   p.base,
		Variables: p.vars,
		Secrets:   p.secrets,
		OnStep:    onStep,
	}
	if p.stack != nil {
		e.State = p.stack
		e.SandboxDB = p.stack.DB()
		e.ShellExec = p.stack.ShellExec
	}
	return e
}

package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/agent"
	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
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

	// Idle tracking for a sandbox the MCP surface brought up. The web side
	// tears the sandbox down when its draft loop ends, so this is the backstop
	// for the paths that never get there -- a crashed web process, a killed
	// dashboard. mcpOwned says the sandbox is research's to reap: the attach
	// loop keeps its own warm by design and claims it back in prepare.
	mcpOwned bool
	busy     int
	idle     *time.Timer
}

// sandboxIdleFor is how long a research sandbox may sit unused before the
// reaper takes it down. Long enough that thinking between tool calls never
// trips it; short enough that a forgotten container does not outlive lunch.
const sandboxIdleFor = 10 * time.Minute

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
	st, err := stage(ctx, s.w, s.cfg)
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

	s.calmIdle()
	s.st.Down(ctx)
	s.st = nil
	s.mcpOwned = false
	if s.store != nil {
		s.store.Close()
		s.store = nil
	}
}

// armIdle (re)starts the reaper countdown. Callers hold mu.
func (s *session) armIdle() {
	if s.idle != nil {
		s.idle.Stop()
	}
	s.idle = time.AfterFunc(sandboxIdleFor, s.reapIdle)
}

// calmIdle stops the countdown. Callers hold mu.
func (s *session) calmIdle() {
	if s.idle != nil {
		s.idle.Stop()
		s.idle = nil
	}
}

// reapIdle takes down a research sandbox nobody has touched in a while. It
// runs on the timer's goroutine, so it takes mu like everyone else. A sandbox
// in use is not idle -- the countdown restarts instead -- and one the attach
// loop claimed is not research's to reap.
func (s *session) reapIdle() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.st == nil || !s.mcpOwned {
		s.calmIdle()
		return
	}
	if s.busy > 0 {
		s.armIdle()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	s.w.Write(term.Line{Kind: term.Info, Text: "sandbox idle, tearing it down"})
	s.st.Down(ctx)
	s.st = nil
	s.mcpOwned = false
	s.idle = nil
}

// prepared is where a plan is about to run: a sandbox restored to its baseline, or
// the API the config points at.
type prepared struct {
	base      string
	container string
	stack     *sandbox.Stack
	vars      map[string]string
	secrets   []string

	// judge is the repair half, nil when no model is reachable. A run that arrived
	// over the wire gets one for the same reason --plan does: a person asked for
	// this run and is not sitting at a prompt to fix a stale URL themselves. The
	// MCP RunPlan tool deliberately has none -- there the caller is already a model.
	judge   *agent.Local
	handler func(plan.Step) run.Handler
	repair  config.Repair
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

	judge, err := repairer(s.w, s.cfg)
	if err != nil {
		return prepared{}, err
	}
	// Only when there is something to repair with: the lookup can cost an index
	// pass, and a project with no model configured should not pay for one.
	var handler func(plan.Step) run.Handler
	if judge != nil {
		handler = s.handlers(ctx)
	}
	ready := prepared{
		vars:    vars.Values,
		judge:   judge,
		handler: handler,
		repair:  s.cfg.Run.RepairOpts(),
	}

	if !s.cfg.Run.Sandboxed() {
		base, err := baseURL(s.w, s.cfg, p)
		if err != nil {
			return prepared{}, err
		}
		if err := probe(ctx, s.cfg, base); err != nil {
			return prepared{}, err
		}
		ready.base, ready.secrets = base, secrets(vars, nil)
		return ready, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	st, err := s.staged(ctx)
	if err != nil {
		return prepared{}, err
	}
	// The attach loop keeps its sandbox warm by design: claiming it back stops
	// the research reaper, and the process teardown is what takes it down.
	s.mcpOwned = false
	s.calmIdle()
	if err := reset(ctx, s.w, st); err != nil {
		return prepared{}, err
	}
	ready.base, ready.container, ready.stack = st.BaseURL(), st.Project(), st
	ready.secrets = secrets(vars, st)
	return ready, nil
}

// handlers is the source the repairer reads to see what serves a failing step. It
// takes mu itself, so it runs before prepare reaches for it -- the sandboxed branch
// holds mu, and this mutex is not reentrant. A snapshot it cannot get is not worth
// failing a run over: the repairer works without one, on the response alone.
func (s *session) handlers(ctx context.Context) func(plan.Step) run.Handler {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, snap, err := s.cached(ctx)
	if err != nil {
		return nil
	}
	return handlers(s.cfg.Root(), snap)
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
func (p prepared) engine(onStep func(run.StepResult), onRepair func(run.Attempt)) *run.Engine {
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
	if p.judge != nil {
		e.Repairer, e.Attempts, e.Budget = p.judge, p.repair.Attempts, p.repair.Budget
		e.Handler = p.handler
		e.OnRepair = onRepair
	}
	return e
}

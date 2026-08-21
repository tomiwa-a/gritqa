package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/mcp"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
	"github.com/gritqa/cli/internal/term"
)

// serve exposes what the CLI can already do as an MCP surface. It is the
// mcp.Backend, which is the whole of app that mcp knows about.
type serve struct {
	cfg  *config.Config
	opts Options
	w    *term.Writer

	// mu serialises the expensive, once-only things: two concurrent get_index
	// calls would contend on one SQLite file, and two start_sandbox calls would
	// each try to bring a sandbox up.
	mu    sync.Mutex
	store *index.Store
	snap  *index.Snapshot
	st    *staged
}

// runServer holds the session open. Stdout is the protocol in stdio mode, so
// every human line goes to stderr — including the transcript an index pass
// writes, which is exactly where an MCP host shows it.
func runServer(ctx context.Context, opts Options) error {
	cfg, _, err := resolveConfig(ctx, opts)
	if err != nil {
		return err
	}

	w := term.New(os.Stderr).Plain()
	b := &serve{cfg: cfg, opts: opts, w: w}
	defer b.close(context.WithoutCancel(ctx))

	srv, err := mcp.New(mcp.Options{
		Project: cfg.Project,
		Root:    cfg.Root(),
		Backend: b,
		Execute: opts.Execute,
		Log:     func(s string) { w.Write(term.Line{Kind: term.Info, Text: s}) },
	})
	if err != nil {
		return err
	}
	return srv.Serve(ctx, opts.Serve)
}

func (b *serve) Index(ctx context.Context) (*index.Snapshot, index.Delta, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	got, err := read(ctx, b.w, b.cfg, b.opts)
	if err != nil {
		return nil, index.Delta{}, err
	}
	b.snap = got.snap
	return got.snap, got.delta, nil
}

func (b *serve) Recipe(ctx context.Context) (sandbox.Recipe, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	store, snap, err := b.cached(ctx)
	if err != nil {
		return sandbox.Recipe{}, err
	}
	return environment(b.w, b.cfg, store, snap)
}

func (b *serve) Propose(_ context.Context, r sandbox.Recipe) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.store == nil {
		return errors.New("the local cache is not open, so there is nowhere to record a proposal")
	}
	body, err := r.Encode()
	if err != nil {
		return err
	}
	if err := b.store.SaveProposal(r.Fingerprint, r.Author, body); err != nil {
		return err
	}
	b.w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("the agent proposes booting this project on %s — accept it by putting it "+
			"under run.sandbox in %s, and until then runs use what they used before", r.Base, config.Name),
	})
	return nil
}

// Sandbox answers with what is up and starts nothing. A tool that reads should
// not leave a container behind on a machine whose owner never asked for one.
func (b *serve) Sandbox() *sandbox.Sandbox {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.st == nil {
		return nil
	}
	return b.st.box
}

func (b *serve) StartSandbox(ctx context.Context) (mcp.Boot, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	already := b.st != nil
	st, err := b.staged(ctx)
	if err != nil {
		return mcp.Boot{}, err
	}
	return mcp.Boot{
		Database: st.box.Env()["DB_NAME"], BaseURL: st.base,
		Tables: st.box.Tables(), Already: already,
	}, nil
}

// RunPlan executes against a restore of the post-seed baseline, so nothing
// research wrote can make a step pass.
//
// No repairer: the caller is already a model. A repair loop inside a tool the
// agent called would be a second model deciding what the first one meant, and the
// agent gets the failed assertions back and can refine instead.
func (b *serve) RunPlan(ctx context.Context, p *plan.Plan) (*run.Result, error) {
	vars := b.cfg.Run.ResolvedVariables()
	if len(vars.Missing) > 0 {
		return nil, fmt.Errorf("run.variables reads %s from the environment, and there is nothing there",
			strings.Join(vars.Missing, ", "))
	}

	b.mu.Lock()
	st, err := b.staged(ctx)
	if err != nil {
		b.mu.Unlock()
		return nil, err
	}
	if err := st.reset(ctx, b.w); err != nil {
		b.mu.Unlock()
		return nil, err
	}
	b.mu.Unlock()

	engine := &run.Engine{
		BaseURL:   st.base,
		Variables: vars.Values,
		Secrets:   secrets(vars, st),
		State:     st.box,
	}
	b.w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("running %s against %s", p.Name, st.base)})
	return engine.Run(ctx, p)
}

func (b *serve) Teardown(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.st == nil {
		return nil
	}
	b.st.close(ctx)
	b.st = nil
	return nil
}

// staged brings the sandbox up for the tools that asked for one — start_sandbox,
// or a run — so --serve costs nothing for a host that only reads. Callers hold mu.
func (b *serve) staged(ctx context.Context) (*staged, error) {
	if b.st != nil {
		return b.st, nil
	}
	if !b.cfg.Run.Sandboxed() {
		return nil, errors.New("this project has no run.sandbox, so there is no database to " +
			"reach and nowhere safe to run a plan — set run.sandbox.image in " + config.Name)
	}
	store, snap, err := b.cached(ctx)
	if err != nil {
		return nil, err
	}
	st, err := stage(ctx, b.w, b.cfg, store, snap)
	if err != nil {
		return nil, err
	}
	b.st = st
	return st, nil
}

// cached opens the index cache once and reads whatever the last pass left. It does
// not index: a tool that needs a recipe or a sandbox should not pay for a walk,
// and get_index is how a client asks for a fresh one. Callers hold mu.
func (b *serve) cached(ctx context.Context) (*index.Store, *index.Snapshot, error) {
	if b.store == nil {
		store, err := index.Open(b.cfg.CachePath())
		if err != nil {
			return nil, nil, fmt.Errorf("could not open the index cache: %w", err)
		}
		b.store = store
	}
	if b.snap == nil {
		if snap, err := b.store.Load(b.cfg.Root()); err == nil {
			b.snap = snap
		}
	}
	if b.snap == nil {
		got, err := read(ctx, b.w, b.cfg, b.opts)
		if err != nil {
			return nil, nil, err
		}
		b.snap = got.snap
	}
	return b.store, b.snap, nil
}

func (b *serve) close(ctx context.Context) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.st.close(ctx)
	if b.store != nil {
		b.store.Close()
	}
}

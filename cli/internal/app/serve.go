package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

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
type serve struct{ *session }

// runServer holds the session open. Stdout is the protocol in stdio mode, so
// every human line goes to stderr — including the transcript an index pass
// writes, which is exactly where an MCP host shows it.
func runServer(ctx context.Context, opts Options) error {
	cfg, _, err := resolveConfig(ctx, opts)
	if err != nil {
		return err
	}

	w := term.New(os.Stderr).Plain()
	b := &serve{session: newSession(cfg, opts, w)}
	defer b.close(context.WithoutCancel(ctx))

	srv, err := mcp.New(mcp.Options{
		Project: cfg.Project,
		Root:    cfg.Root(),
		Backend: b,
		Execute: opts.Execute,
		// Asked for by hand, so the address and its bearer are what the person
		// running it needs to configure a client.
		Printed: true,
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

// Compose reads the developer's own compose files. Nothing is interpreted here:
// which service is the app and which is the database are questions about their
// declaration, and the agent answers them.
func (b *serve) Compose(ctx context.Context) (*sandbox.Compose, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	opts := b.cfg.Run.SandboxOpts()
	files := sandbox.LocateCompose(b.cfg.Root(), sandbox.MountRoot(b.cfg.Root(), opts.Mount), opts.Compose)
	if len(files) == 0 {
		return nil, fmt.Errorf("no compose file found at %s or above it — "+
			"GritQA boots a project the way its own compose file says to, so it needs one; "+
			"name it under run.sandbox.compose in %s if it lives somewhere else",
			b.cfg.Root(), config.Name)
	}
	return sandbox.ReadCompose(ctx, files)
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
	if missing := unset(p, vars.Missing); len(missing) > 0 {
		return nil, fmt.Errorf("run.variables reads %s from the environment, and there is nothing there",
			strings.Join(missing, ", "))
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
		SandboxDB: st.box.DB(),
		ShellExec: st.box.ShellExec,
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

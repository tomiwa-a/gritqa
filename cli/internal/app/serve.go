package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/mcp"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
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
		// Names, never values: the agent has to reference the developer's admin
		// login rather than invent one, and must not learn what it is.
		Variables: cfg.Run.VariableNames(),
		Execute:   opts.Execute,
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

	return composeFor(ctx, b.cfg)
}

// Environment is what has been worked out about the project's compose file, and
// nil when nobody has. GritQA has no fallback answer to offer here: the point of
// the whole seam is that it stops guessing how someone else's project boots.
func (b *serve) Environment(ctx context.Context) (*sandbox.Environment, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	store, _, err := b.cached(ctx)
	if err != nil {
		return nil, err
	}
	body, err := store.Environment()
	if err != nil {
		return nil, err
	}
	return sandbox.DecodeEnvironment(body)
}

// Propose records a proposal and returns the block that approves it, which is
// also what it prints: the person who has to accept this reads a terminal, and
// nothing else here tells them what to write.
func (b *serve) Propose(_ context.Context, e sandbox.Environment) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.store == nil {
		return "", errors.New("the local cache is not open, so there is nowhere to record a proposal")
	}
	body, err := e.Encode()
	if err != nil {
		return "", err
	}
	if err := b.store.SaveEnvironmentProposal(e.Fingerprint, e.Author, body); err != nil {
		return "", err
	}
	accept := config.EnvironmentBlock(toConfig(e))
	b.w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("the agent worked out how this project boots — %s. No run boots on it "+
			"until this is in %s:", e.Describe(), config.Name),
	})
	for _, line := range strings.Split(strings.TrimRight(accept, "\n"), "\n") {
		b.w.Write(term.Line{Kind: term.Out, Text: line})
	}
	return accept, nil
}

// Sandbox answers with what is up and starts nothing. A tool that reads should
// not leave a container behind on a machine whose owner never asked for one.
func (b *serve) Sandbox() *sandbox.Stack {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.st
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
		Database: st.Database(), BaseURL: st.BaseURL(),
		Tables: st.Tables(), Already: already,
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
	if err := reset(ctx, b.w, st); err != nil {
		b.mu.Unlock()
		return nil, err
	}
	b.mu.Unlock()

	engine := &run.Engine{
		BaseURL:   st.BaseURL(),
		Variables: vars.Values,
		Secrets:   secrets(vars, st),
		State:     st,
		SandboxDB: st.DB(),
		ShellExec: st.ShellExec,
	}
	b.w.Write(term.Line{Kind: term.Info,
		Text: fmt.Sprintf("running %s against %s", p.Name, st.BaseURL())})
	return engine.Run(ctx, p)
}

// TrialCall answers whether one endpoint is real: a single request against the
// sandbox as it stands, with no reset, no repair, and no ledger settling. A
// probe is evidence for verification, not a run — it must never soften what it
// finds, fix it, or clean up after it. Guarded names resolve from run
// variables exactly like a run; a name with no value refuses before boot,
// which is what keeps a probe from inventing a credential.
func (b *serve) TrialCall(ctx context.Context, method, path string, headers, query map[string]string, body map[string]any) (*run.StepResult, error) {
	p := &plan.Plan{
		Name: "trial",
		Steps: []plan.Step{{
			ID:   "probe",
			Name: method + " " + path,
			Request: plan.Request{
				Method: method, URL: path,
				Headers: headers, Query: query, Body: body,
			},
		}},
	}
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
	base := st.BaseURL()
	engine := &run.Engine{
		BaseURL:   base,
		Variables: vars.Values,
		Secrets:   secrets(vars, st),
		State:     st,
		SandboxDB: st.DB(),
	}
	b.mu.Unlock()

	b.w.Write(term.Line{Kind: term.Info,
		Text: fmt.Sprintf("probing %s %s against %s", method, path, base)})
	res, err := engine.Run(ctx, p)
	if err != nil {
		return nil, err
	}
	if len(res.Steps) == 0 {
		return nil, errors.New("the probe ran nothing, so there is no answer")
	}
	return &res.Steps[0], nil
}

func (b *serve) Teardown(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.st == nil {
		return nil
	}
	err := b.st.Down(ctx)
	b.st = nil
	return err
}

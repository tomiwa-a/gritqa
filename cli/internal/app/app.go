// Package app is the single command's control flow.
package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/creds"
	"github.com/gritqa/cli/internal/gitinfo"
	"github.com/gritqa/cli/internal/mcp"
	"github.com/gritqa/cli/internal/term"
)

const defaultServer = "https://app.gritqa.dev"

type Options struct {
	Once     bool
	Draft    bool
	Only     []string
	All      bool
	Describe string
	Name     string

	PlanFile   string
	NoConfirm  bool
	Project    string
	Verbose    bool
	JSON       bool
	Logout     bool
	ConfigPath string
	Server     string
	// Version is what this binary reports to the dashboard, so a run can be traced
	// to the release that produced it.
	Version string

	// Serve is "stdio", or a loopback address for Streamable HTTP.
	Serve string
	// Execute advertises the tools that write. Off by default, so a local AI host
	// gets reads unless the user asked for more.
	Execute bool
}

func (o Options) server() string {
	if o.Server != "" {
		return o.Server
	}
	if s := os.Getenv("GRITQA_SERVER"); s != "" {
		return s
	}
	if o.Version == "dev" {
		return "http://localhost:3000"
	}
	return defaultServer
}

func Run(ctx context.Context, opts Options) error {
	w := term.New(os.Stdout)
	if opts.Verbose || opts.JSON {
		w = w.Plain()
	}

	if opts.Logout {
		return logout(w, opts)
	}

	// Before the banner: in stdio mode stdout carries JSON-RPC, and one line of
	// ours on it is a protocol error at the client.
	if opts.Serve != "" {
		return runAndServe(ctx, w, opts)
	}

	w.Write(term.Line{Kind: term.Cmd, Text: "gritqa"})

	cfg, created, err := resolveConfig(ctx, opts)
	if err != nil {
		return err
	}

	if created {
		w.Write(term.Line{
			Kind: term.OK,
			Text: fmt.Sprintf("wrote %s", filepath.Join(config.Dir, config.Name)),
		})
		w.Write(term.Line{
			Kind: term.Info,
			Text: "commit it if you want your team on the same project",
		})
	}

	if opts.PlanFile != "" {
		return runPlan(ctx, w, cfg, opts)
	}

	// A brief can mean nothing but drafting, so it does not also need --draft.
	if opts.Describe != "" {
		opts.Draft = true
	}

	got, err := read(ctx, w, cfg, opts)
	if err != nil {
		return err
	}

	if opts.Draft {
		return draftPlans(ctx, w, cfg, got, opts)
	}
	if opts.Once {
		return nil
	}

	mcpURL, mcpToken := startMCP(ctx, w, cfg, opts, got)
	return attach(ctx, w, cfg, opts, got.snap, mcpURL, mcpToken)
}

// startMCP launches the MCP server in a goroutine and returns its address and
// read bearer token. Empty strings mean the server did not start (e.g. stdio
// mode or a flag that suppressed it).
func startMCP(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options, got *reading) (url, token string) {
	b := &serve{session: newSession(cfg, opts, w)}

	srv, err := mcp.New(mcp.Options{
		Project: cfg.Project,
		Root:    cfg.Root(),
		Backend: b,
		Execute: opts.Execute,
		Log:     func(s string) { w.Write(term.Line{Kind: term.Info, Text: s}) },
	})
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "MCP server not started: " + err.Error()})
		return "", ""
	}

	mcpCtx, _ := context.WithCancel(ctx)
	go func() {
		if err := srv.Serve(mcpCtx, "127.0.0.1:0"); err != nil && !errors.Is(err, context.Canceled) {
			w.Write(term.Line{Kind: term.Info, Text: "MCP server stopped: " + err.Error()})
		}
	}()

	// Wait briefly for the server to bind.
	time.Sleep(200 * time.Millisecond)

	addr := srv.Addr()
	if addr == "" {
		return "", ""
	}
	return "http://" + addr, srv.Tokens()[mcp.Read]
}

// resolveConfig finds the project root and loads its config, writing one on
// first run.
func resolveConfig(ctx context.Context, opts Options) (cfg *config.Config, created bool, err error) {
	if opts.ConfigPath != "" {
		root := filepath.Dir(filepath.Dir(opts.ConfigPath))
		cfg, err = config.Load(root)
		return cfg, false, err
	}

	cwd, err := os.Getwd()
	if err != nil {
		return nil, false, err
	}

	root, hasConfig, err := config.Find(cwd)
	if err != nil {
		return nil, false, errors.New(
			"no project here — run gritqa from the directory holding your go.mod, " +
				"package.json, or requirements.txt")
	}

	if hasConfig {
		cfg, err = config.Load(root)
		return cfg, false, err
	}

	branch := gitinfo.DefaultBranch(ctx, root)
	cfg = config.New(root, branch)
	if opts.Project != "" {
		cfg.Project = opts.Project
	}
	if err := cfg.Save(); err != nil {
		return nil, false, fmt.Errorf("could not write %s: %w",
			filepath.Join(config.Dir, config.Name), err)
	}
	return cfg, true, nil
}

func logout(w *term.Writer, opts Options) error {
	store, err := creds.Open()
	if err != nil {
		return err
	}
	host := opts.server()
	if _, err := store.Get(host); errors.Is(err, creds.ErrNoToken) {
		w.Write(term.Line{Kind: term.Info, Text: "no token stored for " + host})
		return nil
	}
	if err := store.Delete(host); err != nil {
		return err
	}
	w.Write(term.Line{Kind: term.OK, Text: "forgot the token for " + host})
	return nil
}

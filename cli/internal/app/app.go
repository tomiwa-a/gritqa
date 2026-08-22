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
	// ours on it is a protocol error at the client. --serve is the hand-configured
	// surface and nothing else; bare gritqa is the one that also watches a queue.
	if opts.Serve != "" {
		return runServer(ctx, opts)
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

	// One session for both channels: the surface the dashboard researches through,
	// and the loop that runs what it approved. Two would mean two sandboxes and two
	// handles on one cache for one project.
	s := newSession(cfg, opts, w)
	s.snap = got.snap
	defer s.close(context.WithoutCancel(ctx))

	srv, token := startMCP(ctx, w, s)
	return attach(ctx, s, got.snap, srv, token)
}

// bindWithin bounds the wait for a listener. Long enough that a slow machine
// still registers, short enough that nobody watches a blank screen for it.
const bindWithin = 10 * time.Second

// startMCP puts the research surface on loopback, so a dashboard on this machine
// reaches it without anyone copying a URL into an environment. A failed bind is not
// fatal and the server is still returned: dial-out needs no listener, and reporting
// advertises the address only while one is live.
func startMCP(ctx context.Context, w *term.Writer, s *session) (*mcp.Server, string) {
	srv, err := mcp.New(mcp.Options{
		Project: s.cfg.Project,
		Root:    s.cfg.Root(),
		Backend: &serve{session: s},
		Execute: s.opts.Execute,
		// The bearer goes to the dashboard in memory, so it has no reason to be on
		// a screen. --serve, where a person copies it into a client, prints it.
		Log: func(line string) { w.Write(term.Line{Kind: term.Info, Text: line}) },
	})
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "no research surface: " + err.Error()})
		return nil, ""
	}

	go func() {
		if err := srv.Serve(ctx, "127.0.0.1:0"); err != nil && !errors.Is(err, context.Canceled) {
			w.Write(term.Line{Kind: term.Fail, Text: "the research surface stopped: " + err.Error()})
		}
	}()

	select {
	case <-srv.Ready():
	case <-ctx.Done():
	case <-time.After(bindWithin):
	}

	if _, ok := srv.Live(); !ok {
		w.Write(term.Line{Kind: term.Info, Text: "nothing is listening on this machine, so the dashboard " +
			"reaches these tools only over the connection the CLI opens"})
	}
	return srv, srv.Tokens()[mcp.Read]
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

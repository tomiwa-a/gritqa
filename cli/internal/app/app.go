// Package app is the single command's control flow.
package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/creds"
	"github.com/gritqa/cli/internal/gitinfo"
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

	return errors.New("attaching to " + opts.server() +
		" is not wired up yet: for now use --once. The attach loop lands in M4")
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

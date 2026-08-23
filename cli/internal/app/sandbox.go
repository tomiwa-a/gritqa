package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
	"github.com/gritqa/cli/internal/term"
)

// stage brings up a copy of the developer's project on their own compose file,
// runs whatever the environment says brings the schema up, and takes the baseline
// a run is measured against. It is a copy in the strict sense — its own project
// name, its own volumes, its own ports — so whatever they have running is untouched.
func stage(ctx context.Context, w *term.Writer, cfg *config.Config, store *index.Store) (*sandbox.Stack, error) {
	if got := cfg.Retired(); len(got) > 0 {
		w.Write(term.Line{Kind: term.Info, Text: strings.Join(got, ", ") + " no longer mean " +
			"anything: a run boots your compose file, so the image, the schema commands and the " +
			"writable paths are whatever it and run.sandbox.environment say"})
	}
	c, err := composeFor(ctx, cfg)
	if err != nil {
		return nil, err
	}
	env, err := environment(cfg, store, c)
	if err != nil {
		return nil, err
	}
	if env.Stale(c) {
		w.Write(term.Line{Kind: term.Info, Text: "this was worked out from an earlier version of " +
			"your compose file — most edits move none of it, and nothing here has checked which"})
	}

	st, err := sandbox.Launch(ctx, sandbox.LaunchOptions{
		Compose:     c,
		Environment: env,
		Name:        cfg.Project,
		Tables:      cfg.Run.SandboxOpts().Tables,
		OnProgress:  func(s string) { w.Write(term.Line{Kind: term.Info, Text: s}) },
	})
	if err != nil {
		return nil, err
	}
	w.Write(term.Line{Kind: term.OK, Text: fmt.Sprintf(
		"a copy of your project is up as %s — %s, and your own stack is untouched",
		st.Project(), env.Describe())})

	if err := st.Schema(ctx); err != nil {
		st.Down(context.WithoutCancel(ctx))
		return nil, err
	}
	if err := st.Baseline(ctx); err != nil {
		st.Down(context.WithoutCancel(ctx))
		return nil, err
	}
	return st, nil
}

// composeFor reads the developer's own compose files. Nothing is interpreted:
// which service is the app and which holds the data are questions about their
// declaration, not answers this can derive from it.
func composeFor(ctx context.Context, cfg *config.Config) (*sandbox.Compose, error) {
	opts := cfg.Run.SandboxOpts()
	files := sandbox.LocateCompose(cfg.Root(), sandbox.MountRoot(cfg.Root(), opts.Mount), opts.Compose)
	if len(files) == 0 {
		return nil, fmt.Errorf("no compose file found at %s or above it — GritQA boots a project "+
			"the way its own compose file says to, so it needs one; name it under "+
			"run.sandbox.compose in %s if it lives somewhere else", cfg.Root(), config.Name)
	}
	return sandbox.ReadCompose(ctx, files)
}

// environment is what someone worked out about this project's compose file: the
// block a human wrote in their config, or one that was proposed and approved.
// There is no fallback, and that is the point — deciding for itself which service
// is the app is the class of thing GritQA stopped doing.
func environment(cfg *config.Config, store *index.Store, c *sandbox.Compose) (sandbox.Environment, error) {
	if e := cfg.Run.SandboxOpts().Environment; e != nil {
		out := fromConfig(*e)
		return out, out.Check(c)
	}
	if store != nil {
		body, err := store.Environment()
		if err != nil {
			return sandbox.Environment{}, err
		}
		e, err := sandbox.DecodeEnvironment(body)
		if err != nil {
			return sandbox.Environment{}, err
		}
		if e != nil {
			return *e, e.Check(c)
		}
	}
	return sandbox.Environment{}, fmt.Errorf("nothing here knows how this project boots — which "+
		"of %s answers HTTP, which one holds the data, what brings its schema up. Ask the agent to "+
		"read the project and propose an answer with derive_environment, or write "+
		"run.sandbox.environment in %s yourself", strings.Join(c.Names(), ", "), config.Name)
}

func fromConfig(e config.Environment) sandbox.Environment {
	out := sandbox.Environment{
		App: e.App, Port: e.Port, Database: e.Database, DBPort: e.DBPort,
		Driver: e.Driver, Writable: e.Writable, Author: sandbox.AuthorConfig,
		Login: sandbox.Login{User: e.Login.User, Password: e.Login.Password, Name: e.Login.Name},
	}
	for _, s := range e.Schema {
		out.Schema = append(out.Schema, sandbox.SchemaStep{Service: s.Service, Run: s.Run})
	}
	return out
}

// reset returns the copy to what the project's own schema steps produce. Always,
// before the walk: the read tools reach this same copy, and a plan that passes on
// a row research left behind is worse than one that fails.
func reset(ctx context.Context, w *term.Writer, st *sandbox.Stack) error {
	started := time.Now()
	if err := st.Reset(ctx); err != nil {
		return err
	}
	w.Write(term.Line{Kind: term.Info, Text: "back at the baseline", Meta: term.Dur(time.Since(started))})
	return nil
}

// moved renders a step's state delta for the right-hand margin: what changed, in
// the fewest characters that still say which table and how far its key got.
func moved(ms []run.Moved) string {
	if len(ms) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ms))
	for i, m := range ms {
		if i == movedCap {
			parts = append(parts, fmt.Sprintf("+%d more", len(ms)-movedCap))
			break
		}
		parts = append(parts, m.Unit+" "+signed(m.Rows))
	}
	return strings.Join(parts, ", ")
}

const movedCap = 3

func signed(n int64) string {
	if n > 0 {
		return fmt.Sprintf("+%d", n)
	}
	return fmt.Sprintf("%d", n)
}

// ledger is the run's own summary: what the world looks like after, against what
// it looked like before the first step.
func ledger(w *term.Writer, res *run.Result) {
	if res.StateErr != "" {
		w.Write(term.Line{Kind: term.Info, Text: "the state ledger is incomplete: " + res.StateErr})
	}
	if len(res.Moved) == 0 {
		if res.StateErr == "" {
			w.Write(term.Line{Kind: term.Info, Text: "nothing in the database moved"})
		}
		return
	}

	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what moved"})
	for i, m := range res.Moved {
		w.Write(term.Line{
			Kind: term.Tree,
			Text: m.Unit + " " + signed(m.Rows),
			Meta: highWater(m),
			Last: i == len(res.Moved)-1,
		})
	}
}

func highWater(m run.Moved) string {
	switch {
	case m.From == "" && m.To == "":
		return ""
	case m.From == "":
		return "up to " + m.To
	case m.To == "":
		return "from " + m.From
	}
	return m.From + " → " + m.To
}

func size(n int64) string {
	switch {
	case n <= 0:
		return "empty"
	case n < 1<<10:
		return fmt.Sprintf("%d B", n)
	case n < 1<<20:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
}

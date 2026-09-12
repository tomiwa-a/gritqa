package app

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

// stage brings up a copy of the developer's project on their own compose file,
// runs whatever the environment says brings the schema up, and takes the baseline
// a run is measured against. It is a copy in the strict sense — its own project
// name, its own volumes, its own ports — so whatever they have running is untouched.
func stage(ctx context.Context, w *term.Writer, cfg *config.Config) (*sandbox.Stack, error) {
	if got := cfg.Retired(); len(got) > 0 {
		w.Write(term.Line{Kind: term.Info, Text: strings.Join(got, ", ") + " no longer mean " +
			"anything: a run boots your compose file, so the image, the schema commands and the " +
			"writable paths are whatever it and run.sandbox.environment say"})
	}
	c, err := composeFor(ctx, cfg)
	if err != nil {
		return nil, err
	}
	env, err := environment(cfg, c)
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

// environment is what the config file says about this project's compose file:
// one verdict per service, written by a human, checked against the file on
// every boot. There is no fallback, and that is the point — deciding for
// itself which service is the app is the class of thing GritQA stopped doing.
func environment(cfg *config.Config, c *sandbox.Compose) (sandbox.Environment, error) {
	if sb := cfg.Run.SandboxOpts(); sb.Services != nil {
		out := fromConfig(sb)
		if err := out.Check(c); err != nil {
			return sandbox.Environment{}, err
		}
		// Normalize here, once, so every consumer boots exactly what validation
		// approved. Check normalizes a throwaway copy for itself; without this,
		// the verdicts would pass validation while the boot still carried empty
		// App and Port — validated on a phantom, dead on the real thing.
		return out.Normalize(), nil
	}
	return sandbox.Environment{}, fmt.Errorf("no service verdicts in %s — run `gritqa --init` "+
		"to scaffold them from %s, judge each service, and run again",
		config.Name, strings.Join(c.Names(), ", "))
}

// checkConfigured reads the compose file and checks the verdicts against it,
// before anything expensive happens. No sandbox block means a research-only
// setup: nothing to check, nothing to prove. A compose file that will not read
// warns instead of failing — verdict failures are fatal, but a laptop with
// Docker off still has questions to ask, and boots fail later with specifics.
func checkConfigured(ctx context.Context, w *term.Writer, cfg *config.Config) (*sandbox.Compose, error) {
	if cfg.Run == nil || cfg.Run.Sandbox == nil {
		return nil, nil
	}
	c, err := composeFor(ctx, cfg)
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "could not read the compose file, so the " +
			"verdicts go unchecked until a run needs them: " + err.Error()})
		return nil, nil
	}
	if err := fromConfig(*cfg.Run.Sandbox).Check(c); err != nil {
		return nil, err
	}
	return c, nil
}

// trialBoot proves the verdicts once per compose file: a throwaway stage torn
// down immediately, recorded by fingerprint. Unchanged compose never pays
// twice. A failed proof warns loudly and lets the process continue, because
// the verdicts above already decided what may boot — Docker being off is not
// otherwise fatal to a process that also answers questions.
func trialBoot(ctx context.Context, w *term.Writer, cfg *config.Config, c *sandbox.Compose) (bool, error) {
	store, err := index.Open(cfg.CachePath())
	if err != nil {
		return false, err
	}
	defer store.Close()
	if fp, _ := store.Meta("trial_boot"); fp != "" && fp == c.Fingerprint {
		return false, nil
	}
	st, err := stage(ctx, w, cfg)
	if err != nil {
		return true, err
	}
	defer st.Down(context.WithoutCancel(ctx))
	if err := store.SetMeta("trial_boot", c.Fingerprint); err != nil {
		return true, err
	}
	return true, nil
}
func fromConfig(sb config.Sandbox) sandbox.Environment {
	out := sandbox.Environment{
		Author:   sandbox.AuthorConfig,
		Egress:   sb.Egress,
		Writable: sb.Writable,
	}
	names := make([]string, 0, len(sb.Services))
	for name := range sb.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		s := sb.Services[name]
		out.Services = append(out.Services, sandbox.Classification{
			Service: name,
			Role:    sandbox.Role(s.Role),
			Port:    s.Port,
			Why:     s.Why,
			Run:     s.Run,
			Measure: sandbox.Measure(s.Measure),
			Driver:  s.Driver,
		})
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

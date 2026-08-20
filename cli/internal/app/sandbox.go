package app

import (
	"context"
	"fmt"
	"io/fs"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
	"github.com/gritqa/cli/internal/term"
)

// staged is a run's own world: a database GritQA created and an API process it
// started against it. The user's server and their real data are untouched.
type staged struct {
	box  *sandbox.Sandbox
	app  *sandbox.App
	base string
}

// stage brings the sandbox up, works out how the project boots, migrates and
// seeds it with the project's own tooling, records a baseline, and starts the API
// pointed at it.
func stage(ctx context.Context, w *term.Writer, cfg *config.Config, store *index.Store, snap *index.Snapshot) (*staged, error) {
	opts := cfg.Run.SandboxOpts()
	root := cfg.Root()

	recipe, err := environment(w, cfg, store, snap)
	if err != nil {
		return nil, err
	}

	box, err := sandbox.Up(ctx, sandbox.Options{
		Image:      opts.Image,
		Database:   opts.Database,
		Project:    cfg.Project,
		Tables:     opts.Tables,
		OnProgress: func(s string) { w.Write(term.Line{Kind: term.Info, Text: s}) },
	})
	if err != nil {
		return nil, err
	}
	st := &staged{box: box}

	if !opts.OnHost() {
		image, err := box.Build(ctx, recipe)
		if err != nil {
			st.close(context.WithoutCancel(ctx))
			return nil, err
		}
		box.Use(recipe, image)
	}

	// Before the baseline, or it would count the user's own tree instead of the
	// directories GritQA owns.
	if err := box.MakeWritable(); err != nil {
		st.close(context.WithoutCancel(ctx))
		return nil, err
	}
	for _, d := range opts.Watch {
		box.Watch(filepath.Join(root, d))
	}

	w.Write(term.Line{
		Kind: term.OK,
		Text: fmt.Sprintf("%s is up as %s, and it holds nothing of yours", box.Image(), box.Name()),
	})

	steps, err := box.Prepare(ctx, root, prepareCommands(cfg.Run), cfg.Run.Env)
	if err != nil {
		st.close(context.WithoutCancel(ctx))
		return nil, err
	}
	for _, s := range steps {
		w.Write(term.Line{Kind: term.OK, Text: s.Label, Meta: term.Dur(s.Elapsed)})
	}

	if err := box.Baseline(ctx); err != nil {
		st.close(context.WithoutCancel(ctx))
		return nil, err
	}
	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("baseline taken — %s, %s",
			term.Count(len(box.Tables()), "table", "tables"), size(box.BaselineBytes())),
	})

	app, err := box.StartApp(ctx, sandbox.AppOptions{
		Root:  root,
		Start: cfg.Run.Start,
		Port:  cfg.Run.Port,
		Env:   cfg.Run.Env,
		Ready: cfg.Run.Ready,
	})
	if err != nil {
		st.close(context.WithoutCancel(ctx))
		return nil, err
	}
	st.app, st.base = app, app.BaseURL

	w.Write(term.Line{
		Kind: term.OK,
		Text: fmt.Sprintf("your API is answering on %s — %s, and your own server is untouched",
			app.BaseURL, app.How),
	})
	return st, nil
}

// environment works out how this project boots. Only the language is decided here
// and it comes from file extensions; everything else has an author — the user's
// config, their own Dockerfile, a recipe the agent worked out, or the built-in
// table, in that order.
func environment(w *term.Writer, cfg *config.Config, store *index.Store, snap *index.Snapshot) (sandbox.Recipe, error) {
	opts := cfg.Run.SandboxOpts()
	base, file := runtimeSetting(cfg.Root(), opts.Runtime)
	in := sandbox.RecipeInput{
		Root:     cfg.Root(),
		Language: dominant(snap),
		Config: sandbox.Recipe{
			Base:     base,
			File:     file,
			Install:  opts.Install,
			Serve:    cfg.Run.Start,
			Mount:    opts.Mount,
			Workdir:  opts.Workdir,
			Docroot:  opts.Docroot,
			Writable: opts.Writable,
		},
	}
	if store != nil {
		body, err := store.Recipe()
		if err == nil {
			in.Cached, _ = sandbox.DecodeRecipe(body)
		}
	}

	r, err := sandbox.Environment(in, opts.RecipeMode())
	if err != nil || opts.OnHost() {
		return r, err
	}
	if store != nil {
		if body, err := r.Encode(); err == nil {
			store.SaveRecipe(r.Fingerprint, r.Author, body)
		}
	}
	if native, deps := nativeDeps(r); native > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s holds %s compiled for this machine, which Linux will not load — "+
				"set run.sandbox.install if the API cannot start", deps,
				term.Count(native, "library", "libraries")),
		})
	}
	return r, nil
}

// runtimeSetting reads run.sandbox.runtime. auto and host name no image; a path
// whose name says Dockerfile is one; anything else is an image reference, slashes
// and all — ghcr.io/acme/api:3 is not a path.
func runtimeSetting(root, setting string) (base, file string) {
	setting = strings.TrimSpace(setting)
	if setting == "" || strings.EqualFold(setting, "auto") || strings.EqualFold(setting, "host") {
		return "", ""
	}
	if strings.Contains(strings.ToLower(filepath.Base(setting)), "dockerfile") {
		if filepath.IsAbs(setting) {
			return "", setting
		}
		return "", filepath.Join(root, setting)
	}
	return setting, ""
}

// dominant is the project's main language by source bytes. It is the one thing
// about a project worth deciding without a model, and it exists only to break the
// table's single tie — a package.json is JavaScript or TypeScript.
func dominant(snap *index.Snapshot) string {
	if snap == nil {
		return ""
	}
	bytes := map[string]int64{}
	for _, f := range snap.Files {
		if f.Language != "" {
			bytes[f.Language] += f.Size
		}
	}
	best, top := "", int64(0)
	for l, n := range bytes {
		if n > top {
			best, top = l, n
		}
	}
	return best
}

// nativeDeps counts compiled objects in a dependency directory that will be
// mounted rather than built. They are the one thing that silently will not load
// under Linux, and detecting the ABI properly is more than this owes the user.
func nativeDeps(r sandbox.Recipe) (int, string) {
	if r.Install != "" || r.Deps == "" || runtime.GOOS == "linux" {
		return 0, ""
	}
	dir := filepath.Join(r.Mount, r.Installdir, r.Deps)
	n := 0
	filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		switch filepath.Ext(d.Name()) {
		case ".so", ".dylib", ".node":
			n++
		}
		return nil
	})
	return n, r.Deps
}

// reset returns the database to its post-seed baseline. Always, before the walk:
// the read tools reach this same database, and a plan that passes on a row
// research created is worse than one that fails.
func (s *staged) reset(ctx context.Context, w *term.Writer) error {
	started := time.Now()
	if err := s.box.Reset(ctx); err != nil {
		return err
	}
	w.Write(term.Line{Kind: term.Info, Text: "reset to the baseline", Meta: term.Dur(time.Since(started))})
	return nil
}

func (s *staged) close(ctx context.Context) {
	if s == nil {
		return
	}
	if s.app != nil {
		s.app.Stop(ctx)
	}
	if s.box != nil {
		s.box.Down(ctx)
	}
}

func prepareCommands(r *config.Run) []sandbox.Command {
	return []sandbox.Command{
		{Label: "migrated the sandbox", Line: r.Migrate},
		{Label: "seeded the sandbox", Line: r.Seed},
	}
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

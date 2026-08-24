package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/creds"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/source"
	"github.com/gritqa/cli/internal/model"
	"github.com/gritqa/cli/internal/term"
)

// reading is what one index pass produced: the snapshot, what changed since the
// last pass, and whether there was a last pass at all.
type reading struct {
	snap  *index.Snapshot
	delta index.Delta
	first bool
}

// read indexes the project and renders the READ transcript from
// web/src/components/sections/pillars.tsx. What it reports is only what it
// actually found: a project whose router it cannot recognise is told so, rather
// than shown a confident zero.
func read(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options) (*reading, error) {
	started := time.Now()

	store, err := index.Open(cfg.CachePath())
	if err != nil {
		return nil, fmt.Errorf("could not open the index cache: %w — it holds nothing "+
			"you cannot rebuild, so delete %s* and run again", err, cfg.CachePath())
	}
	defer store.Close()

	before, err := store.Hashes()
	if err != nil {
		return nil, err
	}

	paths, err := index.List(ctx, cfg.Root())
	if err != nil {
		return nil, err
	}
	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("reading %s — %s", cfg.Path, term.Count(len(paths), "file", "files")),
	})

	ep := cfg.EndpointOpts()
	io := index.Options{List: ep.List, Spec: ep.Spec, AI: ep.AI}
	if ep.AI {
		io.Extract, io.Cache = extractor(w, opts, cfg), store
	}

	snap, err := index.ReadPaths(ctx, cfg.Root(), paths, io)
	if err != nil {
		return nil, err
	}

	delta := index.Diff(before, snap.Hashes())
	if err := store.Save(snap); err != nil {
		return nil, fmt.Errorf("could not write the index cache: %w", err)
	}

	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what it found"})
	w.All(findings(snap)...)
	w.Write(term.Line{Kind: term.Blank})

	w.Write(term.Line{
		Kind: term.OK,
		Text: summary(len(before) == 0, delta, snap),
		Meta: term.Dur(time.Since(started)),
	})

	if len(before) == 0 {
		w.Write(term.Line{Kind: term.Info, Text: "from here on it only re-reads what you change"})
	}
	if snap.Uploaded > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s went to the model to be read",
				term.Count(snap.Uploaded, "file", "files")),
		})
	}
	if n := len(snap.Failed); n > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("the model could not read %s, so any endpoints in %s are missing",
				term.Count(n, "file", "files"), plural(n, "it", "them")),
		})
		w.All(unread(snap.Failed)...)
		w.Write(term.Line{
			Kind: term.Info,
			Text: "a file the model could not read is not cached, so the next run tries " +
				plural(n, "it", "them") + " again",
		})
	}
	if snap.Uncached > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s could not be cached, so %s will be read again next run",
				term.Count(snap.Uncached, "file", "files"), plural(snap.Uncached, "it", "they")),
		})
	}
	if n := len(snap.Unparsed); n > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s would not parse, so nothing was read from %s",
				term.Count(n, "file", "files"), plural(n, "it", "them")),
		})
	}
	return &reading{snap: snap, delta: delta, first: len(before) == 0}, nil
}

// extractor is the AI source's client: the user's own credentials when they
// have any, otherwise the server that holds them.
func extractor(w *term.Writer, opts Options, cfg *config.Config) source.Extractor {
	m := cfg.Run.ModelOpts()
	c, err := model.New(m.Endpoint, m.Name, credentials(m))
	switch {
	case err == nil:
		if m.TokenCommand != "" && os.Getenv(model.KeyEnv) != "" {
			w.Write(term.Line{
				Kind: term.Info,
				Text: "using run.model.token_command; " + model.KeyEnv + " is ignored",
			})
		}
		return &source.Local{Model: c}
	case errors.Is(err, model.ErrNoModel):
		w.Write(term.Line{Kind: term.Info, Text: "endpoints.ai is on, but reading with the " +
			"model needs a model name — add run.model.name to your config, or export " +
			model.ModelEnv})
		return nil
	case !errors.Is(err, model.ErrNoKey):
		w.Write(term.Line{Kind: term.Info, Text: "endpoints.ai is on, but " + err.Error()})
		return nil
	}

	store, err := creds.Open()
	if err != nil {
		return nil
	}
	entry, err := store.Get(creds.Key{Server: opts.server(), Root: cfg.Root()})
	if err != nil {
		w.Write(term.Line{
			Kind: term.Info,
			Text: "endpoints.ai is on, but reading with the model needs " +
				model.KeyEnv + ", a run.model.token_command, or a login first",
		})
		return nil
	}
	return &source.Client{Server: opts.server(), Token: entry.Token, Project: cfg.Project}
}

func findings(snap *index.Snapshot) []term.Line {
	var lines []term.Line
	add := func(text string) { lines = append(lines, term.Line{Kind: term.Tree, Text: text}) }

	switch {
	case snap.EndpointCount() > 0:
		add(fmt.Sprintf("%s across %s",
			term.Count(snap.EndpointCount(), "endpoint", "endpoints"),
			term.Count(snap.RouteFileCount(), "file", "files")))
		add(origin(snap))
		if n := snap.GuardedCount(); n > 0 {
			add(fmt.Sprintf("%d of them need a logged-in user", n))
		}
	case len(snap.Frameworks) == 0:
		add("no framework I recognise — " + escapeHatch)
	case !lang.Readable(snap.Frameworks):
		add(fmt.Sprintf("this looks like a %s project, which I cannot read from source yet",
			names(lang.Unreadable(snap.Frameworks))))
		add(escapeHatch)
	default:
		add(fmt.Sprintf("your %s code registers no endpoints I could resolve", names(snap.Frameworks)))
	}

	if n := snap.UnresolvedCount(); n > 0 {
		add(fmt.Sprintf("%s whose path I could not work out, so %s left out",
			term.Count(n, "registration", "registrations"), plural(n, "it is", "they are")))
	}

	lines[len(lines)-1].Last = true
	return lines
}

// unread names what the model could not read, grouped by reason. Files that all
// failed the same way are one thing to look at, and the reason is what says
// whether to run it again or change something.
func unread(failed []source.Failure) []term.Line {
	order := make([]string, 0, len(failed))
	by := map[string][]source.Failure{}
	for _, f := range failed {
		if _, seen := by[f.Reason]; !seen {
			order = append(order, f.Reason)
		}
		by[f.Reason] = append(by[f.Reason], f)
	}

	lines := make([]term.Line, 0, len(order))
	for _, reason := range order {
		group := by[reason]
		tries := group[0].Attempts
		for _, f := range group[1:] {
			tries = max(tries, f.Attempts)
		}
		lines = append(lines, term.Line{
			Kind: term.Tree,
			Text: fmt.Sprintf("%s — %s after %s: %s",
				reason, term.Count(len(group), "file", "files"),
				term.Count(tries, "try", "tries"), paths(group)),
		})
	}
	lines[len(lines)-1].Last = true
	return lines
}

// paths lists enough of a group to recognise it and says how much it left out.
func paths(group []source.Failure) string {
	const show = 4
	names := make([]string, 0, show)
	for _, f := range group[:min(show, len(group))] {
		names = append(names, f.Path)
	}
	out := strings.Join(names, ", ")
	if rest := len(group) - len(names); rest > 0 {
		out += fmt.Sprintf(" and %d more", rest)
	}
	return out
}

const escapeHatch = "point me at an OpenAPI file with endpoints.spec, list them under " +
	"endpoints.list, or let me read them with endpoints.ai"

// origin names where the endpoints came from, since a spec and a source scan are
// very different claims about the same numbers.
func origin(snap *index.Snapshot) string {
	switch {
	case snap.Source == source.Static:
		return names(snap.Frameworks)
	case snap.SourceDetail != "":
		return fmt.Sprintf("read from %s, %s", snap.Source, snap.SourceDetail)
	default:
		return "read from " + string(snap.Source)
	}
}

func summary(first bool, delta index.Delta, snap *index.Snapshot) string {
	switch {
	case first && len(snap.Failed) > 0:
		return "mapped your project, but not all of it"
	case first:
		return "mapped your project"
	case delta.Empty():
		return "nothing changed since last time"
	default:
		return fmt.Sprintf("re-read %s", term.Count(delta.Count(), "change", "changes"))
	}
}

func names(ids []lang.ID) string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = string(id)
	}
	return strings.Join(out, ", ")
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// credentials maps run.model onto the transport's view of where a bearer lives.
func credentials(m config.Model) model.Credentials {
	return model.Credentials{Command: m.TokenCommand, TTL: m.TTL()}
}

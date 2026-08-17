package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/term"
)

// read indexes the project and renders the READ transcript from
// web/src/components/sections/pillars.tsx. What it reports is only what it
// actually found: a project whose router it cannot recognise is told so, rather
// than shown a confident zero.
func read(ctx context.Context, w *term.Writer, cfg *config.Config) (*index.Snapshot, error) {
	started := time.Now()

	store, err := index.Open(cfg.CachePath())
	if err != nil {
		return nil, fmt.Errorf("could not open the index cache: %w", err)
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

	snap, err := index.ReadPaths(ctx, cfg.Root(), paths)
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
	if n := len(snap.Unparsed); n > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s would not parse, so nothing was read from %s",
				term.Count(n, "file", "files"), plural(n, "it", "them")),
		})
	}
	return snap, nil
}

func findings(snap *index.Snapshot) []term.Line {
	var lines []term.Line
	add := func(text string) { lines = append(lines, term.Line{Kind: term.Tree, Text: text}) }

	if len(snap.Frameworks) == 0 {
		add("no router I recognise — endpoint discovery needs net/http, chi, gin, echo or fiber")
	} else {
		add(fmt.Sprintf("%s across %s",
			term.Count(snap.EndpointCount(), "endpoint", "endpoints"),
			term.Count(snap.RouteFileCount(), "file", "files")))
		add(names(snap.Frameworks))

		if n := snap.GuardedCount(); n > 0 {
			add(fmt.Sprintf("%d of them need a logged-in user", n))
		}
	}

	lines[len(lines)-1].Last = true
	return lines
}

func summary(first bool, delta index.Delta, snap *index.Snapshot) string {
	switch {
	case first:
		return "mapped your project"
	case delta.Empty():
		return "nothing changed since last time"
	default:
		return fmt.Sprintf("re-read %s", term.Count(delta.Count(), "change", "changes"))
	}
}

func names(fw []routes.Framework) string {
	out := make([]string, len(fw))
	for i, f := range fw {
		out[i] = string(f)
	}
	return strings.Join(out, ", ")
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/draft"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/term"
)

// fileCap bounds one drafting call. Twelve changed files is already a large
// push; past that the plan would be about everything, which is about nothing.
const fileCap = 12

// draftPlans asks the model for a plan covering what changed and writes it to
// .gritqa/drafts/.
func draftPlans(ctx context.Context, w *term.Writer, cfg *config.Config, got *reading) error {
	w.Write(term.Line{Kind: term.Blank})

	files := candidates(got)
	if len(files) == 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: "nothing that registers an endpoint changed, so there is nothing to draft",
		})
		return nil
	}

	base := cfg.Run.ResolvedBaseURL()
	if base == "" {
		return fmt.Errorf("a plan needs to know which API it is for — add run.base_url to %s",
			filepath.Join(config.Dir, config.Name))
	}

	model := cfg.Run.ModelOpts()
	drafter, err := draft.NewLocal(model.Endpoint, model.Name)
	if err != nil {
		return err
	}

	left := 0
	if len(files) > fileCap {
		left, files = len(files)-fileCap, files[:fileCap]
	}

	req, err := request(cfg, got, files, base)
	if err != nil {
		return err
	}

	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("drafting from %s, asking %s",
			term.Count(len(files), "file", "files"), model.Name),
	})
	if left > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s changed as well and %s left out of this draft",
				term.Count(left, "file", "files"), plural(left, "was", "were")),
		})
	}

	p, err := drafter.Draft(ctx, req)
	if err != nil {
		return err
	}

	path, err := writeDraft(cfg, p)
	if err != nil {
		return err
	}

	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{
		Kind: term.OK,
		Text: "drafted " + p.Name,
		Meta: fmt.Sprintf("%s, %s",
			term.Count(len(p.Steps), "step", "steps"),
			term.Count(p.AssertionCount(), "check", "checks")),
	})
	w.Write(term.Line{Kind: term.Info, Text: "wrote " + path})
	w.Write(term.Line{Kind: term.Info, Text: "run it with gritqa --plan " + path})
	return nil
}

// candidates are the changed files that register an endpoint. On a first index
// nothing has changed yet, so every route file is fair game.
func candidates(got *reading) []string {
	registers := make(map[string]bool, len(got.snap.Routes))
	for _, r := range got.snap.Routes {
		registers[r.File] = true
	}

	var out []string
	if got.first {
		for f := range registers {
			out = append(out, f)
		}
		sort.Strings(out)
		return out
	}

	for _, group := range [][]string{got.delta.Added, got.delta.Changed} {
		for _, f := range group {
			if registers[f] {
				out = append(out, f)
			}
		}
	}
	sort.Strings(out)
	return out
}

func request(cfg *config.Config, got *reading, files []string, base string) (draft.Request, error) {
	wanted := make(map[string]bool, len(files))
	for _, f := range files {
		wanted[f] = true
	}

	out := draft.Request{Project: cfg.Project, BaseURL: base, Existing: existing(cfg)}

	for _, f := range files {
		b, err := os.ReadFile(filepath.Join(cfg.Root(), f))
		if err != nil {
			return draft.Request{}, err
		}
		out.Files = append(out.Files, draft.File{
			Path:     f,
			Language: languageOf(got.snap, f),
			Content:  string(b),
		})
	}

	for _, r := range got.snap.Routes {
		if wanted[r.File] {
			out.Endpoints = append(out.Endpoints, draft.Endpoint{
				Signature: r.Signature(),
				File:      r.File,
				Handler:   r.Handler,
				NeedsAuth: r.NeedsAuth(),
			})
		}
	}
	return out, nil
}

// existing lists the drafts already on disk, so the model is not asked for a
// plan the project has.
func existing(cfg *config.Config) []draft.Existing {
	dir := cfg.DraftsPath()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var out []draft.Existing
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		p, err := plan.Load(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, draft.Existing{Name: p.Name, Endpoints: p.Endpoints()})
	}
	return out
}

func languageOf(snap *index.Snapshot, path string) string {
	for _, f := range snap.Files {
		if f.Path == path {
			return f.Language
		}
	}
	return ""
}

func writeDraft(cfg *config.Config, p *plan.Plan) (string, error) {
	dir := cfg.DraftsPath()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}

	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return "", err
	}

	name := freeName(dir, slug(p.Name))
	if err := os.WriteFile(filepath.Join(dir, name), append(b, '\n'), 0o644); err != nil {
		return "", err
	}
	return filepath.Join(config.Dir, "drafts", name), nil
}

// freeName never overwrites a draft already there; an earlier plan for the same
// change is history, not clutter.
func freeName(dir, base string) string {
	name := base + ".json"
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name
		}
		name = fmt.Sprintf("%s-%d.json", base, i)
	}
}

var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slug(name string) string {
	s := strings.Trim(notSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 60 {
		s = strings.Trim(s[:60], "-")
	}
	if s == "" {
		return "plan"
	}
	return s
}

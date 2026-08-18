package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/draft"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/term"
)

// fileCap bounds one drafting pass. A hand-rolled API can carry thirty endpoint
// files; past that the pass costs more than the plans are worth.
const fileCap = 30

// draftPlans asks the model for one plan per endpoint file and writes them to
// .gritqa/drafts/. Per file, not per push: twenty-five controllers described in
// one plan is a plan about nothing.
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

	opts := cfg.Run.ModelOpts()
	drafter, err := draft.NewLocal(opts.Endpoint, opts.Name, credentials(opts))
	if err != nil {
		return err
	}

	left := 0
	if len(files) > fileCap {
		left, files = len(files)-fileCap, files[:fileCap]
	}

	reqs, err := requests(cfg, got, files, base)
	if err != nil {
		return err
	}

	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("drafting from %s, one plan each, asking %s",
			term.Count(len(files), "file", "files"), opts.Name),
	})
	if left > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s changed as well and %s left out of this pass",
				term.Count(left, "file", "files"), plural(left, "was", "were")),
		})
	}

	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what it drafted"})

	wrote := 0
	for i, d := range fan(ctx, drafter, reqs) {
		last := i == len(reqs)-1
		if d.err != nil {
			w.Write(term.Line{
				Kind: term.Tree, Text: files[i] + " — " + d.err.Error(),
				Status: term.Failed, Last: last,
			})
			continue
		}
		if _, err := writeDraft(cfg, d.plan); err != nil {
			return err
		}
		wrote++
		w.Write(term.Line{
			Kind: term.Tree, Text: d.plan.Name, Status: term.Pass, Last: last,
			Meta: fmt.Sprintf("%s, %s",
				term.Count(len(d.plan.Steps), "step", "steps"),
				term.Count(d.plan.AssertionCount(), "check", "checks")),
		})
	}

	w.Write(term.Line{Kind: term.Blank})
	if wrote == 0 {
		return errors.New("nothing was drafted")
	}
	w.Write(term.Line{
		Kind: term.OK,
		Text: fmt.Sprintf("wrote %s to %s",
			term.Count(wrote, "plan", "plans"), filepath.Join(config.Dir, "drafts")),
	})
	w.Write(term.Line{Kind: term.Info, Text: "run one with gritqa --plan <file>"})
	return nil
}

type drafted struct {
	plan *plan.Plan
	err  error
}

// fan drafts concurrently, bounded the way source.FromAI bounds extraction. One
// file the model cannot draft for does not cost the rest of the pass.
func fan(ctx context.Context, d draft.Drafter, reqs []draft.Request) []drafted {
	out := make([]drafted, len(reqs))
	jobs := make(chan int)
	var wg sync.WaitGroup

	for range min(runtime.GOMAXPROCS(0), 4) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				p, err := d.Draft(ctx, reqs[i])
				out[i] = drafted{plan: p, err: err}
			}
		}()
	}

	for i := range reqs {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return stopped(out)
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()
	return out
}

func stopped(out []drafted) []drafted {
	for i := range out {
		if out[i].plan == nil && out[i].err == nil {
			out[i].err = errors.New("the pass stopped before this file")
		}
	}
	return out
}

// candidates are the changed files that register an endpoint. On a first index
// nothing has changed yet, so every route file is fair game.
func candidates(got *reading) []string {
	files := routeFiles(got.snap)
	if got.first {
		return files
	}

	registers := make(map[string]bool, len(files))
	for _, f := range files {
		registers[f] = true
	}

	var out []string
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

func routeFiles(snap *index.Snapshot) []string {
	seen := map[string]bool{}
	var out []string
	for _, r := range snap.Routes {
		if !seen[r.File] {
			seen[r.File] = true
			out = append(out, r.File)
		}
	}
	sort.Strings(out)
	return out
}

func requests(cfg *config.Config, got *reading, files []string, base string) ([]draft.Request, error) {
	have := existing(cfg)

	// Every endpoint, not just this file's: a plan for a guarded controller has to
	// be able to sign in first, and the login lives somewhere else.
	var endpoints []draft.Endpoint
	for _, r := range got.snap.Routes {
		endpoints = append(endpoints, draft.Endpoint{
			Signature: r.Signature(),
			File:      r.File,
			Handler:   r.Handler,
			NeedsAuth: r.NeedsAuth(),
		})
	}

	out := make([]draft.Request, 0, len(files))
	for _, f := range files {
		req := draft.Request{
			Project:   cfg.Project,
			BaseURL:   base,
			Focus:     f,
			Endpoints: endpoints,
			Existing:  have,
		}
		for _, path := range []string{f, support(got.snap, f)} {
			if path == "" {
				continue
			}
			b, err := os.ReadFile(filepath.Join(cfg.Root(), path))
			if err != nil {
				return nil, err
			}
			req.Files = append(req.Files, draft.File{
				Path: path, Language: languageOf(got.snap, path), Content: string(b),
			})
		}
		out = append(out, req)
	}
	return out, nil
}

var signIn = regexp.MustCompile(`(?i)auth|login|session|token`)

// support is the one extra file worth paying for: how to log in. Without it a
// plan for a guarded endpoint has no way to get a token and every step 401s.
func support(snap *index.Snapshot, focus string) string {
	for _, f := range routeFiles(snap) {
		if f != focus && signIn.MatchString(f) {
			return f
		}
	}
	return ""
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

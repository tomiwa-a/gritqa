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
// one plan is a plan about nothing. --describe writes a single plan instead,
// from the user's own words.
func draftPlans(ctx context.Context, w *term.Writer, cfg *config.Config, got *reading, opts Options) error {
	w.Write(term.Line{Kind: term.Blank})

	scopes, missed := candidates(got, opts)
	for _, p := range missed {
		w.Write(term.Line{Kind: term.Info, Text: "nothing in the index matches --only " + p})
	}
	if len(scopes) == 0 && opts.Describe == "" {
		w.Write(term.Line{
			Kind: term.Info,
			Text: "nothing that registers an endpoint changed, so there is nothing to draft — " +
				"--all drafts for every endpoint file, --only <name> for the ones you pick",
		})
		return nil
	}

	base := cfg.Run.ResolvedBaseURL()
	if base == "" {
		return fmt.Errorf("a plan needs to know which API it is for — add run.base_url to %s",
			filepath.Join(config.Dir, config.Name))
	}

	mopts := cfg.Run.ModelOpts()
	drafter, err := draft.NewLocal(mopts.Endpoint, mopts.Name, credentials(mopts))
	if err != nil {
		return err
	}

	left := 0
	if len(scopes) > fileCap {
		left, scopes = len(scopes)-fileCap, scopes[:fileCap]
	}

	reqs, labels, err := requests(cfg, got, scopes, opts, base)
	if err != nil {
		return err
	}

	if opts.Describe != "" {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("drafting one plan from your brief, asking %s", mopts.Name),
		})
	} else {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("drafting from %s, one plan each, asking %s",
				term.Count(len(reqs), "file", "files"), mopts.Name),
		})
	}
	if left > 0 {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("%s %s left out of this pass",
				term.Count(left, "more file", "more files"), plural(left, "was", "were")),
		})
	}

	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what it drafted"})

	wrote := 0
	for i, d := range fan(ctx, drafter, reqs) {
		last := i == len(reqs)-1
		if d.err != nil {
			w.Write(term.Line{
				Kind: term.Tree, Text: labels[i] + " — " + d.err.Error(),
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

// scope is one plan's worth of work: the file to write it for, and the endpoints
// in that file the user picked. No cover means the whole file.
type scope struct {
	file  string
	cover []string
}

// candidates are the files to draft for, and the --only patterns that matched
// nothing. What the user named wins over what changed; on a first index, or with
// --all, every route file is fair game.
func candidates(got *reading, opts Options) (scopes []scope, missed []string) {
	files := routeFiles(got.snap)
	if len(opts.Only) > 0 {
		return picked(got.snap, opts.Only)
	}
	if got.first || opts.All {
		return whole(files), nil
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
	return whole(out), nil
}

func whole(files []string) []scope {
	out := make([]scope, 0, len(files))
	for _, f := range files {
		out = append(out, scope{file: f})
	}
	return out
}

// picked resolves --only against the index. A pattern matching a file path takes
// that whole file; one matching an endpoint signature narrows the plan to those
// endpoints, so --only "POST /login" is a plan about logging in.
func picked(snap *index.Snapshot, only []string) (scopes []scope, missed []string) {
	var pats []string
	for _, p := range only {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			pats = append(pats, p)
		}
	}

	hit := make([]bool, len(pats))
	all := map[string]bool{}
	cover := map[string][]string{}

	for _, r := range snap.Routes {
		file, sig := strings.ToLower(r.File), strings.ToLower(r.Signature())
		byFile, byEndpoint := false, false
		for i, p := range pats {
			switch {
			case strings.Contains(file, p):
				hit[i], byFile = true, true
			case strings.Contains(sig, p):
				hit[i], byEndpoint = true, true
			}
		}
		switch {
		case byFile:
			all[r.File] = true
		case byEndpoint:
			cover[r.File] = append(cover[r.File], r.Signature())
		}
	}

	for i, p := range pats {
		if !hit[i] {
			missed = append(missed, p)
		}
	}

	var files []string
	for f := range all {
		files = append(files, f)
	}
	for f := range cover {
		if !all[f] {
			files = append(files, f)
		}
	}
	sort.Strings(files)

	for _, f := range files {
		scopes = append(scopes, scope{file: f, cover: cover[f]})
	}
	return scopes, missed
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

// requests builds one Request per scope, plus a label per request for the line a
// failure prints. A brief collapses the whole pass into one plan.
func requests(cfg *config.Config, got *reading, scopes []scope, opts Options, base string) ([]draft.Request, []string, error) {
	if opts.Describe != "" {
		req, err := described(cfg, got, scopes, opts, base)
		if err != nil {
			return nil, nil, err
		}
		return []draft.Request{req}, []string{"your brief"}, nil
	}

	have, endpoints := existing(cfg), endpointsOf(got.snap)
	reqs := make([]draft.Request, 0, len(scopes))
	labels := make([]string, 0, len(scopes))

	for _, sc := range scopes {
		req := draft.Request{
			Project:   cfg.Project,
			BaseURL:   base,
			Focus:     sc.file,
			Cover:     sc.cover,
			Endpoints: endpoints,
			Existing:  have,
		}
		files, err := sources(cfg, got, sc.file, support(got.snap, sc.file))
		if err != nil {
			return nil, nil, err
		}
		req.Files = files
		reqs = append(reqs, req)
		labels = append(labels, sc.file)
	}
	return reqs, labels, nil
}

// described is the one-plan-from-a-brief request. The user's words are the
// authority, so there is no focus file: source is sent only for what they scoped
// it to, and otherwise just how to log in.
func described(cfg *config.Config, got *reading, scopes []scope, opts Options, base string) (draft.Request, error) {
	req := draft.Request{
		Project:   cfg.Project,
		BaseURL:   base,
		Brief:     opts.Describe,
		Name:      opts.Name,
		Endpoints: endpointsOf(got.snap),
		Existing:  existing(cfg),
	}

	var paths []string
	for _, sc := range scopes {
		paths = append(paths, sc.file)
		req.Cover = append(req.Cover, sc.cover...)
	}
	if len(paths) > briefCap {
		paths = paths[:briefCap]
	}
	paths = append(paths, support(got.snap, ""))

	files, err := sources(cfg, got, paths...)
	if err != nil {
		return req, err
	}
	req.Files = files
	return req, nil
}

// briefCap bounds the source one described plan carries. Past a handful of files
// the endpoint list says more than the code does.
const briefCap = 4

func sources(cfg *config.Config, got *reading, paths ...string) ([]draft.File, error) {
	seen := map[string]bool{}
	var out []draft.File
	for _, path := range paths {
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		b, err := os.ReadFile(filepath.Join(cfg.Root(), path))
		if err != nil {
			return nil, err
		}
		out = append(out, draft.File{
			Path: path, Language: languageOf(got.snap, path), Content: string(b),
		})
	}
	return out, nil
}

// endpointsOf is every endpoint, not just the focus file's: a plan for a guarded
// controller has to be able to sign in first, and the login lives somewhere else.
func endpointsOf(snap *index.Snapshot) []draft.Endpoint {
	out := make([]draft.Endpoint, 0, len(snap.Routes))
	for _, r := range snap.Routes {
		out = append(out, draft.Endpoint{
			Signature: r.Signature(),
			File:      r.File,
			Handler:   r.Handler,
			NeedsAuth: r.NeedsAuth(),
		})
	}
	return out
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

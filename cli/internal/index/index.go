package index

import (
	"context"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/index/golang"
	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/index/source"
)

type File struct {
	Path     string
	Language string
	Size     int64
	Hash     string
	Symbols  map[golang.SymbolKind]int
}

// Options carries the endpoint-discovery overrides from .gritqa/config.yaml.
type Options struct {
	List []string
	Spec string
	AI   bool
}

type Snapshot struct {
	Root       string
	Files      []File
	Routes     []routes.Route
	Unresolved []routes.Route
	Frameworks []lang.ID
	Unparsed   []string

	// Source is where the endpoints came from, and Detail which file said so.
	Source       source.Kind
	SourceDetail string
}

type outcome struct {
	file       *File
	routes     []routes.Route
	unresolved []routes.Route
	frameworks []lang.ID
	unparsed   bool
}

// List returns the source files worth indexing, repo-relative and in path
// order. Callers that want to report the file count before the slower parse pass
// list first and hand the result to ReadPaths.
func List(ctx context.Context, root string) ([]string, error) {
	return list(ctx, root)
}

// Read indexes the whole project.
func Read(ctx context.Context, root string, opts Options) (*Snapshot, error) {
	paths, err := list(ctx, root)
	if err != nil {
		return nil, err
	}
	return ReadPaths(ctx, root, paths, opts)
}

// ReadPaths hashes and parses the given files concurrently, assembling the
// result in path order so two indexes of an unchanged tree are byte-identical.
//
// Endpoints come from a ladder of sources, cheapest and most private first. The
// project-level ones need no file pass at all, so they are tried before it and
// static extraction is skipped when one of them answers.
func ReadPaths(ctx context.Context, root string, paths []string, opts Options) (*Snapshot, error) {
	res, err := source.Resolve(root, opts.List, opts.Spec)
	if err != nil {
		return nil, err
	}

	out, err := scan(ctx, root, paths, res.Empty())
	if err != nil {
		return nil, err
	}

	snap := &Snapshot{Root: root}
	ids := lang.Detect(root)

	for _, o := range out {
		if o.file == nil {
			continue
		}
		snap.Files = append(snap.Files, *o.file)
		snap.Routes = append(snap.Routes, o.routes...)
		snap.Unresolved = append(snap.Unresolved, o.unresolved...)
		ids = append(ids, o.frameworks...)
		if o.unparsed {
			snap.Unparsed = append(snap.Unparsed, o.file.Path)
		}
	}
	snap.Frameworks = lang.Order(ids)

	switch {
	case !res.Empty():
		snap.Source, snap.SourceDetail = res.Kind, res.Detail
		snap.Routes, snap.Unresolved = res.Routes, res.Unresolved
	case len(snap.Routes) > 0:
		snap.Source = source.Static
	}
	return snap, nil
}

func scan(ctx context.Context, root string, paths []string, wantRoutes bool) ([]outcome, error) {
	out := make([]outcome, len(paths))
	jobs := make(chan int)
	var wg sync.WaitGroup

	for range runtime.GOMAXPROCS(0) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = inspect(root, paths[i], wantRoutes)
			}
		}()
	}

	for i := range paths {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return nil, ctx.Err()
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()
	return out, nil
}

func inspect(root, rel string, wantRoutes bool) outcome {
	var o outcome

	body, hash, size, err := read(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return o
	}

	language := Language(rel)
	o.file = &File{Path: rel, Language: language, Size: size, Hash: hash}
	if language != "go" || body == nil {
		return o
	}

	f, err := golang.Parse(rel, body)
	if err != nil {
		o.unparsed = true
		return o
	}

	o.file.Symbols = golang.Counts(f.Symbols())
	o.frameworks = f.Frameworks()

	// Tests import net/http and register handlers against it; those are not the
	// project's endpoints.
	if wantRoutes && !strings.HasSuffix(rel, "_test.go") {
		o.routes, o.unresolved = f.Routes()
	}
	return o
}

func (s *Snapshot) FileCount() int       { return len(s.Files) }
func (s *Snapshot) EndpointCount() int   { return len(s.Routes) }
func (s *Snapshot) UnresolvedCount() int { return len(s.Unresolved) }

// GuardedCount is how many endpoints sit behind an auth middleware.
func (s *Snapshot) GuardedCount() int {
	n := 0
	for _, r := range s.Routes {
		if r.NeedsAuth() {
			n++
		}
	}
	return n
}

// RouteFileCount is how many files register at least one endpoint.
func (s *Snapshot) RouteFileCount() int {
	seen := map[string]bool{}
	for _, r := range s.Routes {
		seen[r.File] = true
	}
	return len(seen)
}

// Hashes maps path to content hash, the form change detection compares.
func (s *Snapshot) Hashes() map[string]string {
	out := make(map[string]string, len(s.Files))
	for _, f := range s.Files {
		out[f.Path] = f.Hash
	}
	return out
}

type FileRoutes struct {
	File   string
	Routes []routes.Route
}

// ByFile groups endpoints the way the coverage grid renders them.
func (s *Snapshot) ByFile() []FileRoutes {
	var out []FileRoutes
	for _, r := range s.Routes {
		if n := len(out); n > 0 && out[n-1].File == r.File {
			out[n-1].Routes = append(out[n-1].Routes, r)
			continue
		}
		out = append(out, FileRoutes{File: r.File, Routes: []routes.Route{r}})
	}
	return out
}

// Delta is what changed between two indexes. US-02's incremental path only needs
// to re-read these.
type Delta struct {
	Added   []string
	Changed []string
	Removed []string
}

func (d Delta) Empty() bool {
	return len(d.Added) == 0 && len(d.Changed) == 0 && len(d.Removed) == 0
}

func (d Delta) Count() int {
	return len(d.Added) + len(d.Changed) + len(d.Removed)
}

// Diff compares a previous hash map against the current one.
func Diff(before, after map[string]string) Delta {
	var d Delta

	for p, h := range after {
		prev, ok := before[p]
		switch {
		case !ok:
			d.Added = append(d.Added, p)
		case prev != h:
			d.Changed = append(d.Changed, p)
		}
	}
	for p := range before {
		if _, ok := after[p]; !ok {
			d.Removed = append(d.Removed, p)
		}
	}

	sort.Strings(d.Added)
	sort.Strings(d.Changed)
	sort.Strings(d.Removed)
	return d
}

package index

import (
	"context"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/index/golang"
	"github.com/gritqa/cli/internal/index/routes"
)

type File struct {
	Path     string
	Language string
	Size     int64
	Hash     string
	Symbols  map[golang.SymbolKind]int
}

type Snapshot struct {
	Root       string
	Files      []File
	Routes     []routes.Route
	Frameworks []routes.Framework
	Unparsed   []string
}

type outcome struct {
	file       *File
	routes     []routes.Route
	frameworks []routes.Framework
	unparsed   bool
}

// List returns the source files worth indexing, repo-relative and in path
// order. Callers that want to report the file count before the slower parse pass
// list first and hand the result to ReadPaths.
func List(ctx context.Context, root string) ([]string, error) {
	return list(ctx, root)
}

// Read indexes the whole project.
func Read(ctx context.Context, root string) (*Snapshot, error) {
	paths, err := list(ctx, root)
	if err != nil {
		return nil, err
	}
	return ReadPaths(ctx, root, paths)
}

// ReadPaths hashes and parses the given files concurrently, assembling the
// result in path order so two indexes of an unchanged tree are byte-identical.
func ReadPaths(ctx context.Context, root string, paths []string) (*Snapshot, error) {
	out := make([]outcome, len(paths))
	jobs := make(chan int)
	var wg sync.WaitGroup

	for range runtime.GOMAXPROCS(0) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = inspect(root, paths[i])
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

	snap := &Snapshot{Root: root}
	seen := map[routes.Framework]bool{}

	for _, o := range out {
		if o.file == nil {
			continue
		}
		snap.Files = append(snap.Files, *o.file)
		snap.Routes = append(snap.Routes, o.routes...)
		for _, fw := range o.frameworks {
			seen[fw] = true
		}
		if o.unparsed {
			snap.Unparsed = append(snap.Unparsed, o.file.Path)
		}
	}

	for _, fw := range []routes.Framework{routes.Stdlib, routes.Chi, routes.Gin, routes.Echo, routes.Fiber} {
		if seen[fw] {
			snap.Frameworks = append(snap.Frameworks, fw)
		}
	}
	return snap, nil
}

func inspect(root, rel string) outcome {
	var o outcome

	body, hash, size, err := read(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return o
	}

	lang := Language(rel)
	o.file = &File{Path: rel, Language: lang, Size: size, Hash: hash}
	if lang != "go" || body == nil {
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
	if !strings.HasSuffix(rel, "_test.go") {
		o.routes = f.Routes()
	}
	return o
}

func (s *Snapshot) FileCount() int     { return len(s.Files) }
func (s *Snapshot) EndpointCount() int { return len(s.Routes) }

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

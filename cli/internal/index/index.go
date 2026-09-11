package index

import (
	"context"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/tomiwa-a/gritqa/cli/internal/index/golang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/js"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang/lexical"
	"github.com/tomiwa-a/gritqa/cli/internal/index/progress"
	"github.com/tomiwa-a/gritqa/cli/internal/index/python"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/index/source"
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

	Extract source.Extractor // nil until the user opts in
	Cache   source.Cache

	// Progress receives per-file stage events. Nil turns reporting off; the
	// pass behaves identically either way.
	Progress *progress.Progress
	// Known maps paths to the content hash of the last pass. Files whose hash
	// matches are reported as cached — same answer as last time — even though
	// the pass re-reads them.
	Known map[string]string
}

type Snapshot struct {
	Root       string
	Files      []File
	Routes     []routes.Route
	Unresolved []routes.Route
	Frameworks []lang.ID
	Unparsed   []string
	Uploaded   int              // files sent to the model to be read
	AICached   int              // files the model stage answered from cache
	Failed     []source.Failure // the ones it could not read, named and with a reason
	Uncached   int              // files read but not cached, so they will be read again

	// Source is where the endpoints came from, and Detail which file said so.
	Source       source.Kind
	SourceDetail string
}

type outcome struct {
	file       *File
	routes     []routes.Route
	unresolved []routes.Route
	frameworks []lang.ID
	graph      *lexical.Graph // the languages read lexically, resolved project-wide
	unparsed   bool
	dark       bool // no static extractor, so a candidate for the model
}

type pass struct {
	root       string
	project    []lang.ID
	wantRoutes bool
	wantAI     bool
	progress   *progress.Progress
	known      map[string]string
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

// HashPaths reads and hashes every file without parsing anything. It is the
// cheap question — "did anything change?" — asked before the expensive one.
// Files report cached when their hash matches known, which is how a steady
// repo proves it has nothing new to read.
func HashPaths(ctx context.Context, root string, paths []string, known map[string]string, prog *progress.Progress) (map[string]string, error) {
	out := make(map[string]string, len(paths))
	jobs := make(chan int)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	prog.SetTotal(progress.Hash, len(paths))

	for range runtime.GOMAXPROCS(0) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				_, hash, _, err := read(filepath.Join(root, filepath.FromSlash(paths[i])))
				mu.Lock()
				if err != nil {
					if firstErr == nil {
						firstErr = err
					}
					prog.Fail(progress.Hash, paths[i], "unreadable")
				} else {
					out[paths[i]] = hash
					old, seen := known[paths[i]]
					prog.File(progress.Hash, paths[i], seen && old == hash)
				}
				mu.Unlock()
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
	return out, firstErr
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

	// The manifests are read before the file pass, because a Fastify plugin file
	// imports nothing: what makes its router parameter a router is the project
	// having declared the dependency.
	project := lang.Detect(root)

	out, err := scan(ctx, pass{
		root: root, project: project,
		// The cache can answer on its own, so a missing key must not stop the file
		// bodies being collected: without this a keyless run reports no endpoints
		// and overwrites the ones it already had.
		wantRoutes: res.Empty(),
		wantAI:     res.Empty() && opts.AI && (opts.Extract != nil || opts.Cache != nil),
		progress:   opts.Progress,
		known:      opts.Known,
	}, paths)
	if err != nil {
		return nil, err
	}

	snap := &Snapshot{Root: root}
	ids := append([]lang.ID(nil), project...)
	graph := &lexical.Graph{}

	for _, o := range out {
		if o.file == nil {
			continue
		}
		snap.Files = append(snap.Files, *o.file)
		snap.Routes = append(snap.Routes, o.routes...)
		snap.Unresolved = append(snap.Unresolved, o.unresolved...)
		ids = append(ids, o.frameworks...)
		if o.graph != nil {
			graph.Merge(o.graph)
		}
		if o.unparsed {
			snap.Unparsed = append(snap.Unparsed, o.file.Path)
		}
	}
	snap.Frameworks = lang.Order(ids)
	resolve(snap, graph, paths, opts.Progress)

	switch {
	case !res.Empty():
		snap.Source, snap.SourceDetail = res.Kind, res.Detail
		snap.Routes, snap.Unresolved = res.Routes, res.Unresolved
	case len(snap.Routes) > 0:
		snap.Source = source.Static
	}

	if err := extract(ctx, snap, opts, root, out); err != nil {
		return nil, err
	}
	return snap, nil
}

// extract asks the model about the files no other source could answer for.
func extract(ctx context.Context, snap *Snapshot, opts Options, root string, out []outcome) error {
	var files []source.File
	for _, o := range out {
		if o.file == nil || !o.dark {
			continue
		}
		body, _, _, err := read(filepath.Join(root, filepath.FromSlash(o.file.Path)))
		if err != nil || body == nil {
			continue
		}
		files = append(files, source.File{
			Path: o.file.Path, Language: o.file.Language, Hash: o.file.Hash, Content: body,
		})
	}
	// The gateway routes to the rest, so it goes with each of them: neither half
	// of a front-controller URL is in one file.
	if g := source.Gateway(files); g >= 0 {
		with := []source.File{files[g]}
		for i := range files {
			if i != g {
				files[i].Context = with
			}
		}
	}

	opts.Progress.SetTotal(progress.AI, len(files))
	res, err := source.FromAI(ctx, opts.Extract, opts.Cache, files, opts.Progress)
	if err != nil {
		return err
	}
	snap.Uploaded, snap.AICached, snap.Failed, snap.Uncached = res.Uploaded, res.Hits, res.Failed, res.Uncached

	if len(res.Routes) > 0 {
		snap.Routes = groupByFile(append(snap.Routes, res.Routes...))
		if snap.Source == source.None {
			snap.Source = res.Kind
		}
	}
	return nil
}

// resolve finishes the paths a single file could not: an Express router or a
// Django URLconf is usually mounted from somewhere else, so the mount graph is
// only complete once every file has been read.
func resolve(snap *Snapshot, graph *lexical.Graph, paths []string, prog *progress.Progress) {
	prog.SetTotal(progress.Link, 1)
	prog.Complete(progress.Link)
	if graph.Empty() {
		return
	}
	graph.Link(lexical.NewImports(paths))

	found, unresolved := graph.Resolve()
	snap.Routes = groupByFile(append(snap.Routes, found...))
	snap.Unresolved = groupByFile(append(snap.Unresolved, unresolved...))
}

// groupByFile keeps a file's endpoints contiguous, which is what the coverage
// grid groups on. The order within a file is left to whoever extracted it.
func groupByFile(rs []routes.Route) []routes.Route {
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].File < rs[j].File })
	return rs
}

func scan(ctx context.Context, p pass, paths []string) ([]outcome, error) {
	out := make([]outcome, len(paths))
	jobs := make(chan int)
	var wg sync.WaitGroup

	p.progress.SetTotal(progress.Hash, len(paths))
	p.progress.SetTotal(progress.Static, len(paths))

	for range runtime.GOMAXPROCS(0) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = p.inspect(paths[i])
				// The hash is known the moment the file is read, ahead of the
				// parse: two heartbeats per file, so the hash rung fills on
				// full passes and not only on fast-path checks. Pulses, not
				// files — cached-vs-fresh is the parse's story, and the static
				// event below already tells it.
				p.progress.Pulse(progress.Hash, paths[i])
				// Cached means the content hash matches the last pass, so the
				// answer is the same one it gave before — even though this pass
				// re-read it. Unreadable files fail loudly instead of vanishing.
				switch {
				case out[i].file == nil:
					p.progress.Fail(progress.Static, paths[i], "unreadable")
				case out[i].unparsed:
					p.progress.Fail(progress.Static, paths[i], "would not parse")
				default:
					old, seen := p.known[paths[i]]
					p.progress.File(progress.Static, paths[i], seen && old == out[i].file.Hash)
				}
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

func (p pass) inspect(rel string) outcome {
	var o outcome

	body, hash, size, err := read(filepath.Join(p.root, filepath.FromSlash(rel)))
	if err != nil {
		return o
	}

	language := Language(rel)
	o.file = &File{Path: rel, Language: language, Size: size, Hash: hash}
	if body == nil {
		return o
	}
	wantRoutes := p.wantRoutes && !isTest(rel)
	if wantRoutes && p.wantAI && dark(language) {
		o.dark = source.Candidate(rel, body)
	}

	switch language {
	case "go":
		f, err := golang.Parse(rel, body)
		if err != nil {
			o.unparsed = true
			return o
		}
		o.file.Symbols = golang.Counts(f.Symbols())
		o.frameworks = f.Frameworks()
		if wantRoutes {
			o.routes, o.unresolved = f.Routes()
		}

	// Neither of these can finish a path on its own, so they contribute a graph
	// fragment instead of routes.
	case "javascript", "typescript":
		if wantRoutes {
			o.graph, o.frameworks = js.Extract(rel, body, p.project)
		}
	case "python":
		if wantRoutes {
			o.graph, o.frameworks = python.Extract(rel, body)
		}
	}
	return o
}

// dark reports whether a language has no static extractor.
func dark(language string) bool {
	switch language {
	case "", "go", "javascript", "typescript", "python", "sql":
		return false
	}
	return true
}

// isTest reports whether a file is a test. Tests import net/http, spin up
// fixture apps and register handlers against them; none of that is the
// project's endpoints.
func isTest(rel string) bool {
	base := path.Base(rel)
	switch {
	case strings.HasSuffix(base, "_test.go"),
		strings.HasSuffix(base, "_test.py"),
		strings.HasPrefix(base, "test_"):
		return true
	}
	return strings.Contains(base, ".test.") || strings.Contains(base, ".spec.")
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

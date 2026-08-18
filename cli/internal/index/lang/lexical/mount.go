package lexical

import (
	"sort"
	"strings"

	"github.com/gritqa/cli/internal/index/routes"
)

// Every framework GritQA reads without a parser reduces to the same three
// things: an owner that routes hang off, a prefix that owner declares, and
// mounts that attach one owner into another — usually from a different file.
// Resolving the mounts is what turns a relative declaration into an endpoint.

// Ref names an owner: a file, and the variable inside it. An empty Name means
// whatever that file exports, which is how one file mounts another.
type Ref struct {
	File string
	Name string
}

// Decl is one route registration, relative to its owner.
type Decl struct {
	Method     string
	Path       string
	Line       int
	Handler    string
	Middleware []string
	Unresolved bool // the path argument could not be read
}

// Owner is a router: an Express Router, a Fastify plugin, a FastAPI APIRouter,
// a Flask Blueprint, a Django URLconf.
type Owner struct {
	Ref        Ref
	Prefix     string
	Root       bool // an app, not a router: its paths are already absolute
	Exported   bool // this is what the file hands to whoever mounts it
	Middleware []string
	Decls      []Decl
	Unresolved bool // the declared prefix could not be read
}

// Mount attaches a child owner into a parent at a prefix. Spec is the module
// the child was imported from, when it came from another file; Link turns it
// into the child's path once the whole file list is known.
type Mount struct {
	Parent     Ref
	Child      Ref
	Spec       string
	Line       int
	Prefix     string
	Middleware []string
	Unresolved bool // the prefix could not be read
	Override   bool // this prefix replaces the child's own, as Flask's register_blueprint does
}

// Graph is a project's owners and mounts, gathered file by file.
type Graph struct {
	Owners []*Owner
	Mounts []Mount
}

func (g *Graph) Add(o *Owner)   { g.Owners = append(g.Owners, o) }
func (g *Graph) Attach(m Mount) { g.Mounts = append(g.Mounts, m) }
func (g *Graph) Empty() bool    { return len(g.Owners) == 0 }

func (g *Graph) Merge(o *Graph) {
	g.Owners = append(g.Owners, o.Owners...)
	g.Mounts = append(g.Mounts, o.Mounts...)
}

// Link resolves the module specifiers mounts were declared with. A mount whose
// module is not in the index is dropped: the routes under it are then reported
// as unmounted, which is the honest answer, rather than given a guessed prefix.
func (g *Graph) Link(im *Imports) {
	kept := g.Mounts[:0]
	for _, m := range g.Mounts {
		if m.Spec != "" {
			resolved, ok := resolve(im, m)
			if !ok {
				continue
			}
			m.Child.File = resolved
		}
		kept = append(kept, m)
	}
	g.Mounts = kept
}

func resolve(im *Imports, m Mount) (string, bool) {
	if strings.HasSuffix(m.Parent.File, ".py") {
		return im.Python(m.Parent.File, m.Spec)
	}
	return im.JS(m.Parent.File, m.Spec)
}

// Find returns the owner a ref points at. A ref with no name asks for the file's
// export, which is the marked owner or, failing that, its only router.
func (g *Graph) Find(r Ref) *Owner {
	var only *Owner
	count := 0

	for _, o := range g.Owners {
		if o.Ref.File != r.File {
			continue
		}
		if r.Name != "" {
			if o.Ref.Name == r.Name {
				return o
			}
			continue
		}
		if o.Exported {
			return o
		}
		if !o.Root {
			only, count = o, count+1
		}
	}

	if r.Name == "" && count == 1 {
		return only
	}
	return nil
}

// Resolve composes absolute paths. A route is only returned when every prefix
// above it is known; the rest are reported, since a route mounted somewhere
// GritQA could not follow has no path anyone can call.
func (g *Graph) Resolve() (found, unresolved []routes.Route) {
	mounted := map[Ref]bool{}
	children := map[Ref][]Mount{}
	for _, m := range g.Mounts {
		mounted[m.Child] = true
		children[m.Parent] = append(children[m.Parent], m)
		// A mount by export name also claims the owner it resolves to.
		if o := g.Find(m.Child); o != nil {
			mounted[o.Ref] = true
		}
	}

	var out, bad []routes.Route
	for _, o := range g.Owners {
		if o.Root {
			g.walk(o, "", nil, false, false, children, map[Ref]bool{}, &out, &bad)
			continue
		}
		if mounted[o.Ref] {
			continue
		}
		// Never mounted anywhere GritQA could see, so the prefix above these
		// routes is unknowable. The marker names the router to go and look at.
		g.walk(o, "/<"+o.name()+">", nil, true, false, children, map[Ref]bool{}, &out, &bad)
	}

	sortByFile(out)
	sortByFile(bad)
	return out, bad
}

func (g *Graph) walk(o *Owner, prefix string, middleware []string, unknown, override bool,
	children map[Ref][]Mount, seen map[Ref]bool, out, bad *[]routes.Route) {

	if seen[o.Ref] {
		return
	}
	seen[o.Ref] = true
	defer delete(seen, o.Ref)

	base := routes.Join(prefix, o.Prefix)
	if override {
		base = routes.Join(prefix, "")
	}
	unknown = unknown || o.Unresolved
	mw := concat(middleware, o.Middleware)

	for _, d := range o.Decls {
		r := routes.Route{
			Method:     d.Method,
			Path:       routes.Join(base, d.Path),
			File:       o.Ref.File,
			Line:       d.Line,
			Handler:    d.Handler,
			Middleware: concat(mw, d.Middleware),
		}
		if unknown || d.Unresolved {
			*bad = append(*bad, r)
			continue
		}
		*out = append(*out, r)
	}

	for _, m := range children[o.Ref] {
		child := g.Find(m.Child)
		if child == nil {
			continue
		}
		g.walk(child, routes.Join(base, m.Prefix), concat(mw, m.Middleware),
			unknown || m.Unresolved, m.Override, children, seen, out, bad)
	}
}

// name is what the report calls an owner: its variable, or its file.
func (o *Owner) name() string {
	if o.Ref.Name != "" {
		return o.Ref.Name
	}
	return o.Ref.File
}

// sortByFile keeps a file's endpoints together and in a fixed order, which is
// what the coverage grid groups on and what makes two indexes comparable.
func sortByFile(rs []routes.Route) {
	routes.Sort(rs)
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].File < rs[j].File })
}

func concat(a, b []string) []string {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}
	out := make([]string, 0, len(a)+len(b))
	return append(append(out, a...), b...)
}

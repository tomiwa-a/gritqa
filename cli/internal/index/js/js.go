// Package js reads endpoints out of JavaScript and TypeScript without a parser.
//
// Express, Fastify and NestJS all register routes against something — an app, a
// router, a plugin's parameter, a decorated class — and that receiver is what
// keeps a shape from over-matching. A file is full of .get calls that have
// nothing to do with HTTP, so a route is only emitted when its receiver can be
// shown to be a router.
//
// Paths cannot be finished here: an Express router is usually mounted from
// another file. Extract returns a graph fragment, and index composes it.
package js

import (
	"strings"

	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/lang/lexical"
)

// Extract reads one file. project is what the dependency manifests declared,
// which is the only evidence a plugin file — one that imports nothing and takes
// its router as a parameter — belongs to a framework at all.
func Extract(path string, src []byte, project []lang.ID) (*lexical.Graph, []lang.ID) {
	f := &file{
		path:    path,
		toks:    lexical.Scan(lexical.JS, src),
		imports: map[string]imported{},
		owners:  map[string]*lexical.Owner{},
		scopes:  map[int]*scope{},
		graph:   &lexical.Graph{},
		project: map[lang.ID]bool{},
	}
	for _, id := range project {
		f.project[id] = true
	}

	f.calls = lexical.Calls(f.toks)
	f.byEnd = make(map[int]int, len(f.calls))
	for i, c := range f.calls {
		f.byEnd[c.End] = i
	}

	f.readImports()
	f.readOwners()
	f.readControllers()
	f.readCalls()
	f.readExports()

	for _, o := range f.declared {
		f.graph.Add(o)
	}
	return f.graph, f.found
}

type file struct {
	path  string
	toks  []lexical.Token
	calls []lexical.Call
	byEnd map[int]int // token index just past a call, to the call that ended there

	imports  map[string]imported
	owners   map[string]*lexical.Owner
	declared []*lexical.Owner // in declaration order, so two indexes match
	params   map[string]bool
	strings  map[string]string
	scopes   map[int]*scope
	graph    *lexical.Graph
	project  map[lang.ID]bool
	found    []lang.ID
}

// scope is a resolved receiver: the router a call registers against, plus the
// prefix a .route("/x") chain added on the way.
type scope struct {
	owner   *lexical.Owner
	prefix  string
	fixed   bool // the path came from the chain, so verb calls take no path argument
	unknown bool
}

func (f *file) add(o *lexical.Owner) *lexical.Owner {
	f.owners[o.Ref.Name] = o
	f.declared = append(f.declared, o)
	return o
}

func (f *file) ref(name string) lexical.Ref {
	return lexical.Ref{File: f.path, Name: name}
}

func (f *file) note(id lang.ID) {
	for _, seen := range f.found {
		if seen == id {
			return
		}
	}
	f.found = append(f.found, id)
}

// receiver resolves what a call was made on. A name has to be a known router;
// an empty receiver means a chain, which is resolved through the call it hangs
// off — that is how app.route("/x").get(h) reaches app.
func (f *file) receiver(i int) (*scope, bool) {
	c := f.calls[i]
	if recv, _ := c.Recv(); recv != "" {
		if o, ok := f.owners[recv]; ok {
			return &scope{owner: o}, true
		}
		if o, ok := f.plugin(recv); ok {
			return &scope{owner: o}, true
		}
		return nil, false
	}

	if c.Start == 0 || !isDot(f.toks[c.Start-1]) {
		return nil, false
	}
	parent, ok := f.byEnd[c.Start-1]
	if !ok {
		return nil, false
	}
	s, ok := f.scopes[parent]
	if !ok || s == nil {
		return nil, false
	}
	return s, true
}

// plugin recognises the Fastify shape where the router arrives as a function's
// first parameter and the module itself is what gets registered. There is no
// import to key off, so the gate is the project's manifest plus the handful of
// names such a parameter is ever given — without that, a helper's db.get would
// read as a route.
func (f *file) plugin(name string) (*lexical.Owner, bool) {
	if !f.project[lang.Fastify] && !f.project[lang.Express] {
		return nil, false
	}
	if !pluginParams[name] || !f.firstParams()[name] {
		return nil, false
	}
	return f.add(&lexical.Owner{Ref: f.ref(name), Exported: true}), true
}

var pluginParams = map[string]bool{
	"fastify": true, "app": true, "server": true, "instance": true, "router": true,
}

// firstParams collects the first parameter of every function in the file, in
// both spellings: function f(a, b) and (a, b) => …
func (f *file) firstParams() map[string]bool {
	if f.params != nil {
		return f.params
	}
	f.params = map[string]bool{}

	for i, t := range f.toks {
		switch {
		case t.Kind == lexical.Ident && t.Text == "function":
			if j := f.nextParen(i); j >= 0 {
				f.firstParamAt(j)
			}
		case isPunct(t, "=") && i+1 < len(f.toks) && isPunct(f.toks[i+1], ">"):
			f.arrowParam(i)
		}
	}
	return f.params
}

func (f *file) nextParen(from int) int {
	for i := from + 1; i < len(f.toks) && i < from+4; i++ {
		if isPunct(f.toks[i], "(") {
			return i
		}
	}
	return -1
}

func (f *file) firstParamAt(paren int) {
	if paren+1 < len(f.toks) && f.toks[paren+1].Kind == lexical.Ident {
		f.params[f.toks[paren+1].Text] = true
	}
}

func (f *file) arrowParam(arrow int) {
	i := arrow - 1
	if i < 0 {
		return
	}
	if f.toks[i].Kind == lexical.Ident {
		f.params[f.toks[i].Text] = true
		return
	}
	if !isPunct(f.toks[i], ")") {
		return
	}
	for depth := 0; i >= 0; i-- {
		switch {
		case isPunct(f.toks[i], ")"):
			depth++
		case isPunct(f.toks[i], "("):
			if depth--; depth == 0 {
				f.firstParamAt(i)
				return
			}
		}
	}
}

// target reads an argument that should name a router: a local one, or one
// imported from another file, or a require() written inline.
func (f *file) target(arg []lexical.Token) (lexical.Ref, string, bool) {
	if name := lexical.Name(arg); name != "" {
		if _, ok := f.owners[name]; ok {
			return f.ref(name), "", true
		}
		if im, ok := f.imports[name]; ok && im.spec != "" {
			return lexical.Ref{Name: im.name}, im.spec, true
		}
		return lexical.Ref{}, "", false
	}

	if c, ok := lexical.Ctor(arg); ok && c.Name == "require" {
		if spec, ok := lexical.Str(c.Arg(0)); ok && strings.HasPrefix(spec, ".") {
			return lexical.Ref{}, spec, true
		}
	}
	return lexical.Ref{}, "", false
}

func describe(arg []lexical.Token) string {
	if n := lexical.Name(arg); n != "" {
		return "<" + n + ">"
	}
	return "<expr>"
}

func names(args [][]lexical.Token) []string {
	var out []string
	for _, a := range args {
		if n := lexical.Name(a); n != "" {
			out = append(out, n)
			continue
		}
		if c, ok := lexical.Ctor(a); ok {
			out = append(out, c.Name)
		}
	}
	return out
}

func isDot(t lexical.Token) bool { return isPunct(t, ".") }

func isPunct(t lexical.Token, text string) bool {
	return t.Kind == lexical.Punct && t.Text == text
}

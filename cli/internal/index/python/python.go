// Package python reads endpoints out of Python without a parser.
//
// FastAPI, Flask and Django each name their router in a constructor —
// FastAPI(), APIRouter(prefix=…), Flask(__name__), Blueprint(url_prefix=…) — so
// the gate is that the constructor was imported from the framework it belongs
// to. Registrations are decorators, which gates them a second time: a bare
// client.get(url) is an HTTP call, not a route.
//
// Django is the exception, with no constructor and no verb. Its owner is the
// urlpatterns list, and settings.py's ROOT_URLCONF is what makes one of those
// absolute; the rest are reached through include().
package python

import (
	"strings"

	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/lang/lexical"
)

// Extract reads one file, returning a graph fragment. Paths cannot be finished
// here: a router is usually mounted from another module.
func Extract(path string, src []byte) (*lexical.Graph, []lang.ID) {
	f := &file{
		path: path, toks: lexical.Scan(lexical.Python, src),
		imports: map[string]imported{}, owners: map[string]*lexical.Owner{},
		drf: map[string]bool{}, graph: &lexical.Graph{},
	}
	f.calls = lexical.Calls(f.toks)
	for i, t := range f.toks {
		if t.Kind == lexical.Ident && t.Text == "def" {
			f.defs = append(f.defs, i)
		}
	}

	f.readImports()
	f.readOwners()
	f.readDecorators()
	f.readCalls()
	f.publish()

	for _, o := range f.declared {
		f.graph.Add(o)
	}
	return f.graph, f.found
}

type file struct {
	path  string
	toks  []lexical.Token
	calls []lexical.Call
	defs  []int // token index of every def, to name a decorated handler

	imports  map[string]imported
	owners   map[string]*lexical.Owner
	declared []*lexical.Owner // in declaration order, so two indexes match
	drf      map[string]bool  // owners whose register() expands to a viewset's routes
	strings  map[string]string
	graph    *lexical.Graph
	found    []lang.ID
}

func (f *file) ref(name string) lexical.Ref { return lexical.Ref{File: f.path, Name: name} }

func (f *file) add(o *lexical.Owner) *lexical.Owner {
	if existing, ok := f.owners[o.Ref.Name]; ok {
		return existing
	}
	f.owners[o.Ref.Name] = o
	f.declared = append(f.declared, o)
	return o
}

func (f *file) note(id lang.ID) {
	for _, seen := range f.found {
		if seen == id {
			return
		}
	}
	f.found = append(f.found, id)
}

// target reads an argument that should name a router: a local one, or one
// imported from another module. from . import orders makes orders.router reach
// into the module ".orders", which is why the name is split.
func (f *file) target(arg []lexical.Token) (lexical.Ref, string, bool) {
	name := lexical.Name(arg)
	if name == "" {
		return lexical.Ref{}, "", false
	}
	if o, ok := f.owners[name]; ok {
		return o.Ref, "", true
	}

	base, rest := name, ""
	if i := strings.IndexByte(name, '.'); i >= 0 {
		base, rest = name[:i], name[i+1:]
	}
	im, ok := f.imports[base]
	if !ok {
		return lexical.Ref{}, "", false
	}
	if rest == "" {
		return lexical.Ref{Name: im.name}, im.module, true
	}
	return lexical.Ref{Name: rest}, submodule(im.module, im.name), true
}

func submodule(module, name string) string {
	switch {
	case name == "":
		return module
	case strings.HasSuffix(module, "."):
		return module + name
	}
	return module + "." + name
}

// str reads a value that should be a path: a literal, or a name the module binds
// to one. Anything else names itself, so the report points at what to fix.
func (f *file) str(v []lexical.Token) (string, bool) {
	if s, ok := lexical.Str(v); ok {
		return convert(s), true
	}
	if n := lexical.Name(v); n != "" {
		if s, ok := f.consts()[n]; ok {
			return convert(s), true
		}
	}
	return "/" + lexical.Describe(v), false
}

// publish hands this module's path constants to the graph, since a prefix is
// often written in one module and used in another.
func (f *file) publish() {
	for name, v := range f.consts() {
		if strings.HasPrefix(v, "/") {
			f.graph.Bind(lexical.Const{Name: name, Value: convert(v)})
		}
	}
}

// prefix reads a value that should be a router prefix. A name this module does
// not bind is handed on as a reference: the constant may live elsewhere.
func (f *file) prefix(v []lexical.Token) (path, ref string, unresolved bool) {
	if p, known := f.str(v); known {
		return p, "", false
	}
	if n := lexical.Name(v); n != "" {
		return "", n, false
	}
	return "", "", true
}

// consts are the module's string-valued bindings, which is where a prefix
// written once and used twice lives.
func (f *file) consts() map[string]string {
	if f.strings != nil {
		return f.strings
	}
	f.strings = map[string]string{}
	for _, a := range lexical.Assigns(f.toks) {
		if s, ok := lexical.Str(a.Value); ok {
			f.strings[a.Name] = s
		}
	}
	return f.strings
}

// convert rewrites the converter syntax Flask and Django share into the :param
// form the rest of GritQA speaks: <int:order_id> and <order_id> both become
// :order_id. FastAPI's {order_id} is left to routes.Normalize.
func convert(p string) string {
	for {
		at := strings.IndexByte(p, '<')
		if at < 0 {
			return p
		}
		end := strings.IndexByte(p[at:], '>')
		if end < 0 {
			return p
		}
		end += at

		name := p[at+1 : end]
		if c := strings.LastIndexByte(name, ':'); c >= 0 {
			name = name[c+1:]
		}
		p = p[:at] + ":" + name + p[end+1:]
	}
}

// handler names the function a decorator sits on, which is always the next def.
func (f *file) handler(after int) string {
	for _, d := range f.defs {
		if d <= after {
			continue
		}
		if d+1 < len(f.toks) && f.toks[d+1].Kind == lexical.Ident {
			return f.toks[d+1].Text
		}
		return ""
	}
	return ""
}

func isPunct(t lexical.Token, text string) bool {
	return t.Kind == lexical.Punct && t.Text == text
}

package python

import (
	"strings"

	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/lang/lexical"
)

// imported is one local name and the module it came from. name is what it is
// called inside that module, empty for a plain `import x`.
type imported struct {
	module string
	name   string
}

func (f *file) readImports() {
	for i, t := range f.toks {
		if t.Kind != lexical.Ident || !f.startsStatement(i) {
			continue
		}
		switch t.Text {
		case "from":
			f.readFrom(i)
		case "import":
			f.readImport(i + 1)
		}
	}
}

func (f *file) startsStatement(i int) bool {
	return i == 0 || f.toks[i-1].Line < f.toks[i].Line || isPunct(f.toks[i-1], ";")
}

// readFrom handles `from .orders import router as orders_router`, including the
// parenthesised list form.
func (f *file) readFrom(start int) {
	var module strings.Builder
	i := start + 1
	for ; i < len(f.toks); i++ {
		t := f.toks[i]
		switch {
		case t.Kind == lexical.Ident && t.Text == "import":
			f.framework(module.String())
			f.readNames(i+1, module.String())
			return
		case t.Kind == lexical.Ident:
			module.WriteString(t.Text)
		case isPunct(t, "."):
			module.WriteString(".")
		default:
			return
		}
	}
}

// readNames binds the names after `import`, following `as` renames. A bracket
// keeps the statement open across lines, which is how long lists are written.
func (f *file) readNames(from int, module string) {
	depth, line := 0, f.toks[from].Line
	origin := ""

	for i := from; i < len(f.toks); i++ {
		t := f.toks[i]
		if t.Kind == lexical.Punct {
			switch t.Text {
			case "(":
				depth++
				continue
			case ")":
				depth--
				continue
			case ",":
				origin = ""
				continue
			case ";":
				return
			}
		}
		if depth == 0 && t.Line > line {
			return
		}
		line = t.Line

		if t.Kind != lexical.Ident {
			continue
		}
		switch {
		case t.Text == "as":
			// The next identifier renames what was just bound.
			if i+1 < len(f.toks) && f.toks[i+1].Kind == lexical.Ident {
				delete(f.imports, origin)
				f.imports[f.toks[i+1].Text] = imported{module: module, name: origin}
				i++
			}
		default:
			origin = t.Text
			f.imports[origin] = imported{module: module, name: origin}
		}
	}
}

// readImport handles `import fastapi` and `import a.b as c`.
func (f *file) readImport(from int) {
	var module strings.Builder
	line := f.toks[from].Line
	local := ""

	for i := from; i < len(f.toks) && f.toks[i].Line == line; i++ {
		t := f.toks[i]
		if t.Kind == lexical.Ident && t.Text == "as" {
			if i+1 < len(f.toks) && f.toks[i+1].Kind == lexical.Ident {
				local = f.toks[i+1].Text
			}
			break
		}
		if t.Kind == lexical.Ident {
			if local == "" {
				local = t.Text
			}
			module.WriteString(t.Text)
			continue
		}
		if isPunct(t, ".") {
			module.WriteString(".")
			continue
		}
		break
	}

	if local != "" {
		f.framework(module.String())
		f.imports[local] = imported{module: module.String()}
	}
}

// framework names what a module reveals. Django Rest Framework counts as Django,
// since that is the routing it plugs into.
func (f *file) framework(module string) {
	switch root(module) {
	case "fastapi":
		f.note(lang.FastAPI)
	case "flask":
		f.note(lang.Flask)
	case "django", "rest_framework":
		f.note(lang.Django)
	}
}

func root(module string) string {
	if i := strings.IndexByte(module, '.'); i >= 0 {
		return module[:i]
	}
	return module
}

type ownerKind int

const (
	notOwner ownerKind = iota
	rootOwner
	routerOwner
	viewsetRouter
)

// ctors is the gate: a constructor only declares a router when it came from the
// framework that owns that name.
var ctors = map[string]struct {
	module string
	kind   ownerKind
}{
	"FastAPI":       {"fastapi", rootOwner},
	"APIRouter":     {"fastapi", routerOwner},
	"Flask":         {"flask", rootOwner},
	"Blueprint":     {"flask", routerOwner},
	"DefaultRouter": {"rest_framework", viewsetRouter},
	"SimpleRouter":  {"rest_framework", viewsetRouter},
}

// ctor resolves what a constructor call builds, following the import it came
// from — including an alias, and the fastapi.APIRouter() spelling.
func (f *file) ctor(c lexical.Call) ownerKind {
	recv, method := c.Recv()
	if recv != "" {
		im, ok := f.imports[recv]
		if !ok {
			return notOwner
		}
		return match(method, im.module)
	}
	im, ok := f.imports[method]
	if !ok {
		return notOwner
	}
	return match(im.name, im.module)
}

func match(name, module string) ownerKind {
	c, ok := ctors[name]
	if !ok || root(module) != c.module {
		return notOwner
	}
	return c.kind
}

// readOwners finds the routers a module declares. An app's routes are already
// absolute; a router's are relative until something mounts it.
func (f *file) readOwners() {
	for _, a := range lexical.Assigns(f.toks) {
		if a.Name == "ROOT_URLCONF" {
			f.rootURLConf(a)
			continue
		}
		c, ok := lexical.Ctor(a.Value)
		if !ok {
			continue
		}
		switch f.ctor(c) {
		case rootOwner:
			f.add(&lexical.Owner{Ref: f.ref(a.Name), Root: true, Middleware: depends(c.Args)})
		case routerOwner:
			prefix, unresolved := f.prefixOf(c)
			f.add(&lexical.Owner{Ref: f.ref(a.Name), Prefix: prefix,
				Middleware: depends(c.Args), Unresolved: unresolved})
		case viewsetRouter:
			f.drf[a.Name] = true
			f.add(&lexical.Owner{Ref: f.ref(a.Name)})
		}
	}
	f.readURLPatterns()
}

// prefixOf reads a router's own prefix. An unreadable one is not no prefix: it
// poisons every path below it, which is what Unresolved carries.
func (f *file) prefixOf(c lexical.Call) (string, bool) {
	for _, key := range []string{"prefix", "url_prefix"} {
		if v, ok := lexical.Kwarg(c.Args, key); ok {
			p, known := f.str(v)
			return p, !known
		}
	}
	return "", false
}

// depends reads FastAPI's dependencies=[Depends(x)], which is where an auth
// requirement declared for a whole router lives.
func depends(args [][]lexical.Token) []string {
	v, ok := lexical.Kwarg(args, "dependencies")
	if !ok {
		return nil
	}
	var out []string
	for _, c := range lexical.Calls(v) {
		if c.Name == "Depends" || c.Name == "Security" {
			out = append(out, lexical.Names(c.Args)...)
		}
	}
	return out
}

package js

import (
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang/lexical"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
)

// NestJS declares routes as decorators on a class, so there is nothing to mount
// and no receiver to resolve: the @ is the gate.
var decorators = map[string]string{
	"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH",
	"Delete": "DELETE", "All": "",
}

func (f *file) readControllers() {
	var current *lexical.Owner
	var pending []string

	for _, c := range f.calls {
		if c.Start == 0 || !isPunct(f.toks[c.Start-1], "@") {
			continue
		}

		switch {
		case c.Name == "Controller":
			f.note(lang.NestJS)
			current = f.controller(c, pending)
			pending = nil
		case c.Name == "UseGuards" || c.Name == "UseInterceptors":
			pending = append(pending, lexical.Names(c.Args)...)
		default:
			method, ok := decorators[c.Name]
			if !ok || current == nil {
				continue
			}
			f.decorated(c, current, method, pending)
			pending = nil
		}
	}
}

// controller names the owner after the class the decorator sits on. Its paths
// are absolute — a Nest controller is not mounted anywhere.
func (f *file) controller(c lexical.Call, guards []string) *lexical.Owner {
	prefix, known := f.decoratorPath(c)
	return f.add(&lexical.Owner{
		Ref:        f.ref(f.className(c.End)),
		Prefix:     prefix,
		Root:       true,
		Exported:   true,
		Middleware: guards,
		Unresolved: !known,
	})
}

func (f *file) decorated(c lexical.Call, o *lexical.Owner, method string, guards []string) {
	p, known := f.decoratorPath(c)
	o.Decls = append(o.Decls, lexical.Decl{
		Method:     method,
		Path:       p,
		Line:       c.Line,
		Handler:    f.methodName(c.End),
		Middleware: guards,
		Unresolved: !known,
	})
}

// decoratorPath reads a decorator's argument. No argument is not a failure: it
// means the path is the controller's own.
func (f *file) decoratorPath(c lexical.Call) (string, bool) {
	if len(c.Args) == 0 {
		return "", true
	}
	if s, ok := lexical.Str(c.Arg(0)); ok {
		return routes.Normalize(s), true
	}
	if s, ok := f.consts()[lexical.Name(c.Arg(0))]; ok {
		return routes.Normalize(s), true
	}
	return "/" + lexical.Describe(c.Arg(0)), false
}

// className reads the class a controller decorator is attached to, skipping the
// export and abstract keywords that may sit between them.
func (f *file) className(from int) string {
	for i := from; i < len(f.toks) && i < from+8; i++ {
		if f.toks[i].Kind == lexical.Ident && f.toks[i].Text == "class" &&
			i+1 < len(f.toks) {
			return f.toks[i+1].Text
		}
	}
	return ""
}

// methodName reads the method a verb decorator is attached to, past any further
// decorators stacked underneath it.
func (f *file) methodName(from int) string {
	for i := from; i < len(f.toks); i++ {
		switch {
		case isPunct(f.toks[i], "@"):
			i = f.pastArgs(i)
		case f.toks[i].Kind == lexical.Ident:
			if keywords[f.toks[i].Text] {
				continue
			}
			return f.toks[i].Text
		case isPunct(f.toks[i], "}"):
			return ""
		}
	}
	return ""
}

var keywords = map[string]bool{
	"async": true, "public": true, "private": true, "protected": true,
	"readonly": true, "static": true, "override": true,
}

// pastArgs walks over a stacked decorator so the name after it is still found.
func (f *file) pastArgs(at int) int {
	depth := 0
	for i := at; i < len(f.toks); i++ {
		switch {
		case isPunct(f.toks[i], "("):
			depth++
		case isPunct(f.toks[i], ")"):
			if depth--; depth == 0 {
				return i
			}
		case depth == 0 && f.toks[i].Line > f.toks[at].Line:
			return i - 1
		}
	}
	return at
}

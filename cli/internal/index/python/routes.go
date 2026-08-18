package python

import (
	"github.com/gritqa/cli/internal/index/lang/lexical"
	"github.com/gritqa/cli/internal/index/routes"
)

var verbs = map[string]string{
	"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH", "delete": "DELETE",
}

// readDecorators reads the registrations. Every one of them is a decorator, so
// requiring the @ costs nothing and rules out a verb method called on a router
// for any other reason.
func (f *file) readDecorators() {
	for _, c := range f.calls {
		if c.Start == 0 || !isPunct(f.toks[c.Start-1], "@") {
			continue
		}
		recv, method := c.Recv()
		o, ok := f.owners[recv]
		if !ok {
			continue
		}
		switch method {
		case "route", "api_route":
			f.declare(c, o, methodsOf(c.Args))
		default:
			if verb, ok := verbs[method]; ok {
				f.declare(c, o, []string{verb})
			}
		}
	}
}

func (f *file) declare(c lexical.Call, o *lexical.Owner, methods []string) {
	path, known := f.str(c.Arg(0))
	for _, m := range methods {
		o.Decls = append(o.Decls, lexical.Decl{
			Method: m, Path: path, Line: c.Line,
			Handler: f.handler(c.End), Middleware: depends(c.Args),
			Unresolved: !known,
		})
	}
}

// methodsOf reads Flask's methods=["GET", "POST"]. No list means GET, which is
// Flask's own default; a list nothing could be read from means the path is real
// but the verb is not, so it lands as ANY.
func methodsOf(args [][]lexical.Token) []string {
	v, ok := lexical.Kwarg(args, "methods")
	if !ok {
		return []string{"GET"}
	}
	var out []string
	for _, t := range v {
		if t.Kind != lexical.String {
			continue
		}
		if m, canonical := routes.Method(t.Text); canonical {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		return []string{""}
	}
	return out
}

// readCalls reads the mounts, and the one call that stands in for a whole set of
// routes: a DRF viewset registration.
func (f *file) readCalls() {
	for _, c := range f.calls {
		recv, method := c.Recv()
		o, ok := f.owners[recv]
		if !ok {
			continue
		}
		switch method {
		case "include_router":
			f.mount(c, o, "prefix", false)
		case "register_blueprint":
			f.mount(c, o, "url_prefix", true)
		case "register":
			if f.drf[recv] {
				f.viewset(c, o)
			}
		}
	}
}

// mount attaches a router declared elsewhere. Flask's url_prefix replaces the
// blueprint's own rather than composing with it, which is what override carries.
func (f *file) mount(c lexical.Call, o *lexical.Owner, key string, override bool) {
	child, spec, ok := f.target(c.Arg(0))
	if !ok {
		return
	}

	prefix, ref, unknown := "", "", false
	v, given := lexical.Kwarg(c.Args, key)
	if given {
		prefix, ref, unknown = f.prefix(v)
	}
	f.graph.Attach(lexical.Mount{
		Parent: o.Ref, Child: child, Spec: spec, Line: c.Line,
		Prefix: prefix, PrefixRef: ref, Middleware: depends(c.Args),
		Unresolved: unknown, Override: override && given,
	})
}

// viewsetRoutes is what DRF's SimpleRouter generates for one registration. The
// lookup defaults to pk, and extra @action routes live on the viewset itself,
// which is another file.
var viewsetRoutes = []struct{ method, path string }{
	{"GET", ""}, {"POST", ""},
	{"GET", "{pk}"}, {"PUT", "{pk}"}, {"PATCH", "{pk}"}, {"DELETE", "{pk}"},
}

func (f *file) viewset(c lexical.Call, o *lexical.Owner) {
	prefix, known := f.str(c.Arg(0))
	handler := lexical.Name(c.Arg(1))
	for _, r := range viewsetRoutes {
		o.Decls = append(o.Decls, lexical.Decl{
			Method: r.method, Path: routes.Join(prefix, r.path), Line: c.Line,
			Handler: handler, Unresolved: !known,
		})
	}
}

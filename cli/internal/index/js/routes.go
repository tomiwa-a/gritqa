package js

import (
	"strings"

	"github.com/gritqa/cli/internal/index/lang/lexical"
	"github.com/gritqa/cli/internal/index/routes"
)

var verbs = map[string]string{
	"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH",
	"delete": "DELETE", "del": "DELETE",
	"all": "", "any": "", // registered for every verb, which the model spells ANY
}

func (f *file) readCalls() {
	for i := range f.calls {
		c := f.calls[i]
		s, ok := f.receiver(i)
		if !ok {
			continue
		}

		_, method := c.Recv()
		switch {
		case method == "route":
			// Fastify passes a whole route as an object; Express opens a chain.
			if isObject(c.Arg(0)) {
				f.routeObject(c, s)
				break
			}
			if !s.fixed {
				if inner := f.routeScope(c, s); inner != nil {
					f.scopes[i] = inner
				}
			}
			continue
		case method == "use":
			f.use(c, s)
		case method == "register":
			f.register(c, s)
		case method == "addHook", method == "decorate":
		default:
			verb, isVerb := verbs[method]
			if !isVerb {
				continue
			}
			f.verb(c, s, verb)
		}
		f.scopes[i] = s
	}
}

// routeScope opens an app.route("/x") chain: the path is fixed here, and the
// verb calls that follow take handlers only.
func (f *file) routeScope(c lexical.Call, s *scope) *scope {
	p, known, isRoute := f.pathOf(c.Arg(0))
	if !isRoute {
		return nil
	}
	return &scope{
		owner:   s.owner,
		prefix:  routes.Join(s.prefix, p),
		fixed:   true,
		unknown: s.unknown || !known,
	}
}

func (f *file) verb(c lexical.Call, s *scope, method string) {
	handlers, path, known := c.Args, s.prefix, true

	if !s.fixed {
		// A single argument is Express reading a setting, not registering a route.
		if len(c.Args) < 2 {
			return
		}
		p, ok, isRoute := f.pathOf(c.Arg(0))
		if !isRoute {
			return
		}
		handlers, path, known = c.Args[1:], routes.Join(s.prefix, p), ok
	}

	d := lexical.Decl{
		Method:     method,
		Path:       path,
		Line:       c.Line,
		Unresolved: s.unknown || !known,
	}
	if n := len(handlers); n > 0 {
		d.Handler = lexical.Name(handlers[n-1])
		d.Middleware = lexical.Names(handlers[:n-1])
	}
	s.owner.Decls = append(s.owner.Decls, d)
}

// use is both of Express's meanings. Mounting a router is the one that changes
// the path; path-scoped middleware decorates one path rather than the router, so
// it is left off, and only a bare use(fn) contributes middleware.
func (f *file) use(c lexical.Call, s *scope) {
	at, child, spec := f.mountArg(c)
	if at < 0 {
		if _, literal := lexical.Str(c.Arg(0)); !literal {
			s.owner.Middleware = append(s.owner.Middleware, lexical.Names(c.Args)...)
		}
		return
	}

	prefix, ref, unknown := "", "", false
	if at > 0 {
		if _, literal := lexical.Str(c.Arg(0)); literal {
			p, _, isRoute := f.pathOf(c.Arg(0))
			if !isRoute {
				return
			}
			prefix = p
		} else {
			prefix, ref, unknown = f.prefix(c.Arg(0))
		}
	}
	f.attach(s, child, spec, prefix, ref, unknown, c.Line, lexical.Names(c.Args[:at]))
}

// register is Fastify's mount. The prefix lives in an options object, and an
// options object GritQA cannot read means an unknown prefix, not no prefix.
func (f *file) register(c lexical.Call, s *scope) {
	child, spec, ok := f.target(c.Arg(0))
	if !ok {
		return
	}

	prefix, ref, unknown := "", "", false
	if len(c.Args) > 1 {
		if v, found := lexical.Kwarg(c.Args[1:], "prefix"); found {
			prefix, ref, unknown = f.prefix(v)
		} else if !isObject(c.Arg(1)) {
			prefix, ref, unknown = f.prefix(c.Arg(1))
		}
	}
	f.attach(s, child, spec, prefix, ref, unknown, c.Line, nil)
}

// routeObject is Fastify's other spelling: { method, url, handler }. A method it
// cannot read still leaves a real endpoint, so it lands as ANY rather than being
// dropped — only an unreadable url makes the route unusable.
func (f *file) routeObject(c lexical.Call, s *scope) {
	v, found := lexical.Kwarg(c.Args, "url")
	if !found {
		return
	}
	url, known := f.str(v)

	d := lexical.Decl{
		Path:       routes.Join(s.prefix, url),
		Line:       c.Line,
		Unresolved: s.unknown || !known,
	}
	if h, ok := lexical.Kwarg(c.Args, "handler"); ok {
		d.Handler = lexical.Name(h)
	}

	for _, m := range methodsOf(c.Args) {
		d.Method = m
		s.owner.Decls = append(s.owner.Decls, d)
	}
}

// methodsOf reads the verbs a route object declares, in either the single or the
// array form.
func methodsOf(args [][]lexical.Token) []string {
	v, found := lexical.Kwarg(args, "method")
	if !found {
		return []string{""}
	}

	var out []string
	for _, t := range v {
		if t.Kind != lexical.String {
			continue
		}
		if m, ok := routes.Method(t.Text); ok {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		return []string{""}
	}
	return out
}

// str reads a value that should be a path: a literal, or an identifier the file
// binds to one. Anything else names itself, so the report points at what to fix.
func (f *file) str(v []lexical.Token) (string, bool) {
	if s, ok := lexical.Str(v); ok {
		return s, true
	}
	if s, ok := f.consts()[lexical.Name(v)]; ok {
		return s, true
	}
	return "/" + lexical.Describe(v), false
}

func (f *file) attach(s *scope, child lexical.Ref, spec, prefix, ref string,
	unknown bool, line int, middleware []string) {

	f.graph.Attach(lexical.Mount{
		Parent:     s.owner.Ref,
		Child:      child,
		Spec:       spec,
		Prefix:     routes.Join(s.prefix, prefix),
		PrefixRef:  ref,
		Line:       line,
		Middleware: middleware,
		Unresolved: unknown || s.unknown,
	})
}

// publish hands this file's path constants to the graph, since a prefix is often
// written in one module and used in another.
func (f *file) publish() {
	for name, v := range f.consts() {
		if strings.HasPrefix(v, "/") {
			f.graph.Bind(lexical.Const{Name: name, Value: v})
		}
	}
}

// prefix reads a value that should be a mount prefix. A name this file does not
// bind is handed on as a reference: the constant may live elsewhere.
func (f *file) prefix(v []lexical.Token) (path, ref string, unresolved bool) {
	if p, known := f.str(v); known {
		return p, "", false
	}
	if n := lexical.Name(v); n != "" {
		return "", n, false
	}
	return "", "", true
}

// mountArg finds which argument names a router, and so whether this call mounts
// one at all. Only argument 0 can be the prefix, so a later argument wins it: a
// prefix written as an imported constant otherwise reads as the router itself.
func (f *file) mountArg(c lexical.Call) (int, lexical.Ref, string) {
	for i, arg := range c.Args {
		if i == 0 && len(c.Args) > 1 {
			continue
		}
		if ref, spec, ok := f.target(arg); ok {
			return i, ref, spec
		}
	}
	if len(c.Args) > 1 {
		if ref, spec, ok := f.target(c.Arg(0)); ok {
			return 0, ref, spec
		}
	}
	return -1, lexical.Ref{}, ""
}

func isObject(arg []lexical.Token) bool {
	return len(arg) > 0 && isPunct(arg[0], "{")
}

// pathOf adds the question str cannot answer: whether this was a route at all.
// A literal that is not a path means it never was, since res.get("etag") reaches
// the same code.
func (f *file) pathOf(arg []lexical.Token) (string, bool, bool) {
	if s, ok := lexical.Str(arg); ok && !strings.HasPrefix(s, "/") {
		return "", false, false
	}
	p, known := f.str(arg)
	return p, known, true
}

// consts are the file's string-valued bindings, which is where a prefix written
// once and used twice lives.
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

package golang

import (
	"go/ast"
	"go/token"
	"strconv"
	"strings"

	"github.com/gritqa/cli/internal/index/routes"
)

// Routes returns the endpoints this file registers, in source order.
//
// Extraction is keyed on call shape rather than on framework, because the five
// supported routers use disjoint shapes and real projects mix them. A file that
// imports no known router is skipped: without that gate, an unrelated
// store.Put("/tmp/x", data) would read as a route.
func (f *File) Routes() []routes.Route {
	if len(f.frameworks) == 0 {
		return nil
	}

	w := &walker{file: f}
	for _, d := range f.ast.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		root := newEnv(nil)
		w.block(fn.Body, root)
	}
	return routes.Dedupe(w.out)
}

// binding is a router value: the prefix its routes hang off, and the middleware
// registered on it so far.
type binding struct {
	prefix     string
	middleware []string
}

func derive(base *binding, path string, mw []string) *binding {
	b := &binding{}
	if base != nil {
		b.prefix = base.prefix
		b.middleware = append(b.middleware, base.middleware...)
	}
	if path != "" {
		b.prefix = routes.Join(b.prefix, path)
	}
	b.middleware = append(b.middleware, mw...)
	return b
}

func (b *binding) copy() *binding { return derive(b, "", nil) }

type env struct {
	parent *env
	root   *env // nearest function or closure scope, for late-bound routers
	names  map[string]*binding
}

func newEnv(parent *env) *env {
	e := &env{parent: parent, names: map[string]*binding{}}
	e.root = e
	return e
}

// child shares its parent's root, so a router first seen inside an if-block is
// still visible to the rest of the function.
func (e *env) child() *env {
	c := newEnv(e)
	c.root = e.root
	return c
}

func (e *env) lookup(name string) *binding {
	for s := e; s != nil; s = s.parent {
		if b, ok := s.names[name]; ok {
			return b
		}
	}
	return nil
}

type walker struct {
	file *File
	out  []routes.Route
}

func (w *walker) block(b *ast.BlockStmt, e *env) {
	if b == nil {
		return
	}
	inner := e.child()
	for _, s := range b.List {
		w.stmt(s, inner)
	}
}

func (w *walker) stmt(s ast.Stmt, e *env) {
	switch s := s.(type) {
	case *ast.ExprStmt:
		w.expr(s.X, e)
	case *ast.AssignStmt:
		w.assign(s, e)
	case *ast.DeclStmt:
		if g, ok := s.Decl.(*ast.GenDecl); ok {
			for _, spec := range g.Specs {
				if v, ok := spec.(*ast.ValueSpec); ok {
					w.valueSpec(v, e)
				}
			}
		}
	case *ast.BlockStmt:
		w.block(s, e)
	case *ast.IfStmt:
		if s.Init != nil {
			w.stmt(s.Init, e)
		}
		w.block(s.Body, e)
		if s.Else != nil {
			w.stmt(s.Else, e)
		}
	case *ast.ForStmt:
		w.block(s.Body, e)
	case *ast.RangeStmt:
		w.block(s.Body, e)
	case *ast.SwitchStmt:
		w.block(s.Body, e)
	case *ast.TypeSwitchStmt:
		w.block(s.Body, e)
	case *ast.SelectStmt:
		w.block(s.Body, e)
	case *ast.CaseClause:
		for _, st := range s.Body {
			w.stmt(st, e)
		}
	case *ast.CommClause:
		for _, st := range s.Body {
			w.stmt(st, e)
		}
	case *ast.LabeledStmt:
		w.stmt(s.Stmt, e)
	case *ast.GoStmt:
		w.expr(s.Call, e)
	case *ast.DeferStmt:
		w.expr(s.Call, e)
	case *ast.ReturnStmt:
		for _, r := range s.Results {
			w.expr(r, e)
		}
	}
}

func (w *walker) assign(s *ast.AssignStmt, e *env) {
	for i, rhs := range s.Rhs {
		if len(s.Rhs) == len(s.Lhs) {
			if id, ok := s.Lhs[i].(*ast.Ident); ok && id.Name != "_" {
				if b := w.resolve(rhs, e); b != nil {
					e.names[id.Name] = b
					continue
				}
			}
		}
		w.expr(rhs, e)
	}
}

func (w *walker) valueSpec(v *ast.ValueSpec, e *env) {
	for i, val := range v.Values {
		if i < len(v.Names) && v.Names[i].Name != "_" {
			if b := w.resolve(val, e); b != nil {
				e.names[v.Names[i].Name] = b
				continue
			}
		}
		w.expr(val, e)
	}
}

func (w *walker) expr(x ast.Expr, e *env) {
	switch x := x.(type) {
	case *ast.CallExpr:
		w.call(x, e)
	case *ast.FuncLit:
		w.block(x.Body, newEnv(e))
	case *ast.ParenExpr:
		w.expr(x.X, e)
	case *ast.BinaryExpr:
		w.expr(x.X, e)
		w.expr(x.Y, e)
	}
}

func (w *walker) call(c *ast.CallExpr, e *env) {
	sel, ok := c.Fun.(*ast.SelectorExpr)
	if !ok {
		w.descend(c, e)
		return
	}

	switch name := sel.Sel.Name; name {
	case "Route", "Mount":
		w.scopeCall(c, sel.X, e, true)
		return
	case "Group":
		w.scopeCall(c, sel.X, e, false)
		return
	case "Use":
		w.use(c, sel.X, e)
	case "Handle", "HandleFunc":
		w.handle(c, sel.X, e)
	case "Method", "MethodFunc", "Add":
		w.verbFirst(c, sel.X, e)
	default:
		if m, ok := routes.Method(name); ok {
			w.verbNamed(m, c, sel.X, e)
		}
	}
	w.descend(c, e)
}

func (w *walker) descend(c *ast.CallExpr, e *env) {
	if sel, ok := c.Fun.(*ast.SelectorExpr); ok {
		w.expr(sel.X, e)
	}
	for _, a := range c.Args {
		w.expr(a, e)
	}
}

// verbNamed handles r.Get("/x", h) and r.GET("/x", h) across all four routers.
func (w *walker) verbNamed(method string, c *ast.CallExpr, recv ast.Expr, e *env) {
	if len(c.Args) < 2 {
		return
	}
	p, ok := w.pathArg(c, 0)
	if !ok {
		return
	}
	b := w.bindingFor(recv, e)
	w.add(c.Lparen, method, routes.Join(b.prefix, p), handlerOf(c.Args, 1), b.middleware)
}

// verbFirst handles chi's Method/MethodFunc and echo's Add, where the verb is
// the first argument.
func (w *walker) verbFirst(c *ast.CallExpr, recv ast.Expr, e *env) {
	if len(c.Args) < 3 {
		return
	}
	v, ok := w.stringArg(c, 0)
	if !ok {
		return
	}
	m, ok := routes.Method(v)
	if !ok {
		return
	}
	p, ok := w.pathArg(c, 1)
	if !ok {
		return
	}
	b := w.bindingFor(recv, e)
	w.add(c.Lparen, m, routes.Join(b.prefix, p), handlerOf(c.Args, 2), b.middleware)
}

// handle covers gin's Handle(verb, path, h) and net/http's HandleFunc, whose Go
// 1.22 patterns may carry the verb inline ("POST /products/{id}").
func (w *walker) handle(c *ast.CallExpr, recv ast.Expr, e *env) {
	if len(c.Args) >= 3 {
		if v, ok := w.stringArg(c, 0); ok {
			if _, isVerb := routes.Method(v); isVerb {
				w.verbFirst(c, recv, e)
				return
			}
		}
	}
	if len(c.Args) < 2 {
		return
	}

	pattern, ok := w.stringArg(c, 0)
	if !ok {
		return
	}
	method, p := splitPattern(pattern)
	if !strings.HasPrefix(p, "/") {
		return
	}

	b := w.bindingFor(recv, e)
	w.add(c.Lparen, method, routes.Join(b.prefix, p), handlerOf(c.Args, 1), b.middleware)
}

// splitPattern reads a net/http pattern. A registration with no verb keeps an
// empty method rather than a guessed one — the CLI reports those separately.
func splitPattern(pattern string) (method, path string) {
	pattern = strings.TrimSpace(pattern)
	if i := strings.IndexByte(pattern, ' '); i > 0 {
		if m, ok := routes.Method(pattern[:i]); ok {
			return m, strings.TrimSpace(pattern[i+1:])
		}
		return "", ""
	}
	return "", pattern
}

// scopeCall handles the two prefix forms: chi's closure (r.Route("/x", func(r
// chi.Router){…})) and the group value (v1 := r.Group("/v1")). withPath marks
// callers whose first argument is always a path, which chi's Group is not.
func (w *walker) scopeCall(c *ast.CallExpr, recv ast.Expr, e *env, withPath bool) {
	base := w.bindingFor(recv, e)

	prefix, rest := "", c.Args
	if p, ok := w.pathArg(c, 0); ok {
		prefix, rest = p, c.Args[1:]
	} else if withPath {
		w.descend(c, e)
		return
	}

	scope := derive(base, prefix, w.middlewareOf(rest))
	for _, a := range rest {
		if fl, ok := a.(*ast.FuncLit); ok {
			w.funcLit(fl, scope, e)
			continue
		}
		w.expr(a, e)
	}
}

// funcLit walks a router closure with its first parameter bound to scope.
func (w *walker) funcLit(fl *ast.FuncLit, scope *binding, e *env) {
	inner := newEnv(e)
	if fl.Type.Params != nil && len(fl.Type.Params.List) > 0 {
		if names := fl.Type.Params.List[0].Names; len(names) > 0 && names[0].Name != "_" {
			inner.names[names[0].Name] = scope.copy()
		}
	}
	w.block(fl.Body, inner)
}

func (w *walker) use(c *ast.CallExpr, recv ast.Expr, e *env) {
	b := w.bindingFor(recv, e)
	b.middleware = append(b.middleware, w.middlewareOf(c.Args)...)
}

// bindingFor resolves a receiver to its router, registering an unseen one at the
// enclosing function scope so a later r.Use still reaches it.
func (w *walker) bindingFor(x ast.Expr, e *env) *binding {
	if b := w.resolve(x, e); b != nil {
		return b
	}
	if name := exprName(x); name != "" {
		b := &binding{}
		e.root.names[name] = b
		return b
	}
	return &binding{}
}

func (w *walker) resolve(x ast.Expr, e *env) *binding {
	switch x := x.(type) {
	case *ast.Ident:
		return e.lookup(x.Name)
	case *ast.SelectorExpr:
		return e.lookup(exprName(x))
	case *ast.ParenExpr:
		return w.resolve(x.X, e)
	case *ast.CallExpr:
		sel, ok := x.Fun.(*ast.SelectorExpr)
		if !ok {
			return nil
		}
		switch sel.Sel.Name {
		case "Group", "Route":
			base := w.resolve(sel.X, e)
			if p, ok := w.pathArg(x, 0); ok {
				return derive(base, p, w.middlewareOf(x.Args[1:]))
			}
			return derive(base, "", w.middlewareOf(x.Args))
		case "With":
			return derive(w.resolve(sel.X, e), "", w.middlewareOf(x.Args))
		}
	}
	return nil
}

func (w *walker) add(pos token.Pos, method, path, handler string, mw []string) {
	if path == "" {
		return
	}
	w.out = append(w.out, routes.Route{
		Method:     method,
		Path:       path,
		File:       w.file.Path,
		Line:       w.file.fset.Position(pos).Line,
		Handler:    handler,
		Middleware: append([]string(nil), mw...),
	})
}

func (w *walker) pathArg(c *ast.CallExpr, i int) (string, bool) {
	s, ok := w.stringArg(c, i)
	if !ok || !strings.HasPrefix(s, "/") {
		return "", false
	}
	return s, true
}

func (w *walker) stringArg(c *ast.CallExpr, i int) (string, bool) {
	if i >= len(c.Args) {
		return "", false
	}
	return w.stringOf(c.Args[i])
}

func (w *walker) stringOf(x ast.Expr) (string, bool) {
	switch x := x.(type) {
	case *ast.BasicLit:
		if x.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(x.Value)
		return s, err == nil
	case *ast.Ident:
		s, ok := w.file.consts[x.Name]
		return s, ok
	case *ast.SelectorExpr:
		// http.MethodGet and friends.
		if p, ok := x.X.(*ast.Ident); ok && p.Name == "http" && strings.HasPrefix(x.Sel.Name, "Method") {
			return strings.TrimPrefix(x.Sel.Name, "Method"), true
		}
		return "", false
	case *ast.ParenExpr:
		return w.stringOf(x.X)
	case *ast.BinaryExpr:
		if x.Op != token.ADD {
			return "", false
		}
		l, lok := w.stringOf(x.X)
		r, rok := w.stringOf(x.Y)
		if !lok || !rok {
			return "", false
		}
		return l + r, true
	}
	return "", false
}

func (w *walker) middlewareOf(args []ast.Expr) []string {
	var out []string
	for _, a := range args {
		switch a.(type) {
		case *ast.FuncLit, *ast.BasicLit:
			continue
		}
		if n := calleeName(a); n != "" {
			out = append(out, n)
		}
	}
	return out
}

func handlerOf(args []ast.Expr, i int) string {
	if i >= len(args) {
		return ""
	}
	return calleeName(args[i])
}

func calleeName(x ast.Expr) string {
	switch x := x.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.SelectorExpr:
		return exprName(x)
	case *ast.CallExpr:
		return calleeName(x.Fun)
	}
	return ""
}

// exprName renders an identifier or dotted path, the two receiver forms worth
// keying an environment on.
func exprName(x ast.Expr) string {
	switch x := x.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.SelectorExpr:
		if base := exprName(x.X); base != "" {
			return base + "." + x.Sel.Name
		}
	}
	return ""
}

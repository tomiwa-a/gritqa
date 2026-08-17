// Package golang extracts routes and symbols from Go source with go/ast.
// A real parser beats a generic grammar here, and it costs no CGO — which is
// what keeps `go install` and the cross-compiled releases working.
package golang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"strings"

	"github.com/gritqa/cli/internal/index/lang"
)

type File struct {
	Path string

	fset       *token.FileSet
	ast        *ast.File
	consts     map[string]string
	frameworks map[lang.ID]bool

	// routerPkgs holds the local names of imported router packages, httpPkg the
	// one for net/http. routerFields and routerVars are the names in this file
	// known to hold a router.
	routerPkgs   map[string]bool
	httpPkg      string
	routerFields map[string]bool
	routerVars   map[string]bool
}

func Parse(path string, src []byte) (*File, error) {
	fset := token.NewFileSet()
	tree, err := parser.ParseFile(fset, path, src, parser.SkipObjectResolution)
	if err != nil {
		return nil, err
	}

	f := &File{
		Path:         path,
		fset:         fset,
		ast:          tree,
		consts:       map[string]string{},
		frameworks:   map[lang.ID]bool{},
		routerPkgs:   map[string]bool{},
		routerFields: map[string]bool{},
		routerVars:   map[string]bool{},
	}
	f.scanImports()
	f.scanConsts()
	f.scanRouters()
	return f, nil
}

// Frameworks lists the routers this file imports, so the CLI can say "I do not
// recognise your framework" instead of silently reporting zero endpoints.
func (f *File) Frameworks() []lang.ID {
	ids := make([]lang.ID, 0, len(f.frameworks))
	for id := range f.frameworks {
		ids = append(ids, id)
	}
	return lang.Order(ids)
}

func (f *File) scanImports() {
	for _, im := range f.ast.Imports {
		p, err := strconv.Unquote(im.Path.Value)
		if err != nil {
			continue
		}
		id, ok := frameworkOf(p)
		if !ok {
			continue
		}
		f.frameworks[id] = true

		local := localName(im, p)
		f.routerPkgs[local] = true
		if id == lang.NetHTTP {
			f.httpPkg = local
		}
	}
}

// localName is how this file refers to a package: its alias, or the last path
// segment with a major-version suffix dropped, since chi/v5 is spelled chi.
func localName(im *ast.ImportSpec, path string) string {
	if im.Name != nil {
		return im.Name.Name
	}
	base := path[strings.LastIndexByte(path, '/')+1:]
	if strings.HasPrefix(base, "v") && len(base) > 1 {
		if _, err := strconv.Atoi(base[1:]); err == nil {
			trimmed := strings.TrimSuffix(path, "/"+base)
			return trimmed[strings.LastIndexByte(trimmed, '/')+1:]
		}
	}
	return base
}

// scanRouters records the struct fields and file-level variables that hold a
// router. Both are receivers routes get registered on in real code, and neither
// carries its type at the call site.
func (f *File) scanRouters() {
	for _, d := range f.ast.Decls {
		g, ok := d.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range g.Specs {
			switch spec := spec.(type) {
			case *ast.TypeSpec:
				st, ok := spec.Type.(*ast.StructType)
				if !ok || st.Fields == nil {
					continue
				}
				for _, fld := range st.Fields.List {
					if f.isRouterType(fld.Type) {
						record(f.routerFields, fld.Names)
					}
				}
			case *ast.ValueSpec:
				if f.isRouterType(spec.Type) {
					record(f.routerVars, spec.Names)
					continue
				}
				for i, v := range spec.Values {
					if i < len(spec.Names) && f.isRouterCtor(v) {
						f.routerVars[spec.Names[i].Name] = true
					}
				}
			}
		}
	}
}

func record(set map[string]bool, names []*ast.Ident) {
	for _, n := range names {
		if n.Name != "_" {
			set[n.Name] = true
		}
	}
}

// routerTypeNames are the types routes can be registered on. The package
// qualifier has to be an imported router too, so a project's own Group or App
// type is not mistaken for one.
var routerTypeNames = map[string]bool{
	"ServeMux": true,
	"Router":   true, "Mux": true,
	"Engine": true, "RouterGroup": true, "IRouter": true, "IRoutes": true,
	"Echo": true, "Group": true, "App": true,
}

func (f *File) isRouterType(x ast.Expr) bool {
	switch x := x.(type) {
	case *ast.StarExpr:
		return f.isRouterType(x.X)
	case *ast.SelectorExpr:
		p, ok := x.X.(*ast.Ident)
		return ok && f.routerPkgs[p.Name] && routerTypeNames[x.Sel.Name]
	}
	return false
}

var routerCtorNames = map[string]bool{
	"NewServeMux": true, "NewRouter": true, "NewMux": true,
	"New": true, "Default": true,
}

// isRouterCtor reports whether a call hands back a fresh router.
func (f *File) isRouterCtor(x ast.Expr) bool {
	c, ok := x.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := c.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	p, ok := sel.X.(*ast.Ident)
	return ok && f.routerPkgs[p.Name] && routerCtorNames[sel.Sel.Name]
}

// frameworkOf matches an import against the table, where a Go framework's
// dependency name is also its import prefix.
func frameworkOf(importPath string) (lang.ID, bool) {
	if importPath == "net/http" {
		return lang.NetHTTP, true
	}
	for _, fw := range lang.Frameworks {
		if fw.Language == "go" && fw.Dep != "" && strings.HasPrefix(importPath, fw.Dep) {
			return fw.ID, true
		}
	}
	return "", false
}

// scanConsts records file-level string constants, so a route registered against
// a shared prefix constant still resolves to a path.
func (f *File) scanConsts() {
	for _, d := range f.ast.Decls {
		g, ok := d.(*ast.GenDecl)
		if !ok || (g.Tok != token.CONST && g.Tok != token.VAR) {
			continue
		}
		for _, spec := range g.Specs {
			v, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, name := range v.Names {
				if i >= len(v.Values) {
					break
				}
				lit, ok := v.Values[i].(*ast.BasicLit)
				if ok && lit.Kind == token.STRING {
					if s, err := strconv.Unquote(lit.Value); err == nil {
						f.consts[name.Name] = s
					}
				}
			}
		}
	}
}

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

	"github.com/gritqa/cli/internal/index/routes"
)

type File struct {
	Path string

	fset       *token.FileSet
	ast        *ast.File
	consts     map[string]string
	frameworks map[routes.Framework]bool
}

func Parse(path string, src []byte) (*File, error) {
	fset := token.NewFileSet()
	tree, err := parser.ParseFile(fset, path, src, parser.SkipObjectResolution)
	if err != nil {
		return nil, err
	}

	f := &File{
		Path:       path,
		fset:       fset,
		ast:        tree,
		consts:     map[string]string{},
		frameworks: map[routes.Framework]bool{},
	}
	f.scanImports()
	f.scanConsts()
	return f, nil
}

// Frameworks lists the routers this file imports, so the CLI can say "I do not
// recognise your framework" instead of silently reporting zero endpoints.
func (f *File) Frameworks() []routes.Framework {
	out := make([]routes.Framework, 0, len(f.frameworks))
	for _, fw := range knownFrameworks {
		if f.frameworks[fw] {
			out = append(out, fw)
		}
	}
	return out
}

var knownFrameworks = []routes.Framework{
	routes.Stdlib, routes.Chi, routes.Gin, routes.Echo, routes.Fiber,
}

func (f *File) scanImports() {
	for _, im := range f.ast.Imports {
		p, err := strconv.Unquote(im.Path.Value)
		if err != nil {
			continue
		}
		if fw, ok := frameworkOf(p); ok {
			f.frameworks[fw] = true
		}
	}
}

func frameworkOf(importPath string) (routes.Framework, bool) {
	switch {
	case importPath == "net/http":
		return routes.Stdlib, true
	case strings.HasPrefix(importPath, "github.com/go-chi/chi"):
		return routes.Chi, true
	case strings.HasPrefix(importPath, "github.com/gin-gonic/gin"):
		return routes.Gin, true
	case strings.HasPrefix(importPath, "github.com/labstack/echo"):
		return routes.Echo, true
	case strings.HasPrefix(importPath, "github.com/gofiber/fiber"):
		return routes.Fiber, true
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

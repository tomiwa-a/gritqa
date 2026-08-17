package golang

import (
	"go/ast"
	"go/token"
)

type SymbolKind string

const (
	Func   SymbolKind = "func"
	Method SymbolKind = "method"
	Type   SymbolKind = "type"
	Const  SymbolKind = "const"
	Var    SymbolKind = "var"
)

type Symbol struct {
	Kind     SymbolKind
	Name     string
	Receiver string
	Line     int
	Exported bool
}

// Symbols returns the file's top-level declarations. This is the shape that goes
// up when no router is recognised, so the CLI can report what it read instead of
// claiming zero endpoints.
func (f *File) Symbols() []Symbol {
	var out []Symbol

	for _, d := range f.ast.Decls {
		switch d := d.(type) {
		case *ast.FuncDecl:
			s := Symbol{
				Kind:     Func,
				Name:     d.Name.Name,
				Line:     f.line(d.Name.Pos()),
				Exported: d.Name.IsExported(),
			}
			if d.Recv != nil && len(d.Recv.List) > 0 {
				s.Kind = Method
				s.Receiver = receiverName(d.Recv.List[0].Type)
			}
			out = append(out, s)

		case *ast.GenDecl:
			for _, spec := range d.Specs {
				out = append(out, f.symbolsOf(d.Tok, spec)...)
			}
		}
	}
	return out
}

func (f *File) symbolsOf(tok token.Token, spec ast.Spec) []Symbol {
	switch spec := spec.(type) {
	case *ast.TypeSpec:
		return []Symbol{{
			Kind:     Type,
			Name:     spec.Name.Name,
			Line:     f.line(spec.Name.Pos()),
			Exported: spec.Name.IsExported(),
		}}

	case *ast.ValueSpec:
		kind := Var
		if tok == token.CONST {
			kind = Const
		}
		out := make([]Symbol, 0, len(spec.Names))
		for _, n := range spec.Names {
			if n.Name == "_" {
				continue
			}
			out = append(out, Symbol{
				Kind:     kind,
				Name:     n.Name,
				Line:     f.line(n.Pos()),
				Exported: n.IsExported(),
			})
		}
		return out
	}
	return nil
}

func (f *File) line(p token.Pos) int { return f.fset.Position(p).Line }

// Counts summarises Symbols for the index upload.
func Counts(syms []Symbol) map[SymbolKind]int {
	out := map[SymbolKind]int{}
	for _, s := range syms {
		out[s.Kind]++
	}
	return out
}

func receiverName(x ast.Expr) string {
	switch x := x.(type) {
	case *ast.StarExpr:
		return receiverName(x.X)
	case *ast.IndexExpr: // generic receiver: Store[T]
		return receiverName(x.X)
	case *ast.IndexListExpr:
		return receiverName(x.X)
	case *ast.Ident:
		return x.Name
	}
	return ""
}

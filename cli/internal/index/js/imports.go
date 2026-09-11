package js

import (
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang/lexical"
)

// imported is one local name and where it came from. spec is set for a relative
// module, which a mount can follow; pkg for a bare one, which it cannot. name is
// what the name is called inside that module, empty for a default import.
type imported struct {
	spec string
	pkg  string
	name string
}

func (f *file) readImports() {
	for i, t := range f.toks {
		if t.Kind == lexical.Ident && t.Text == "import" && f.startsStatement(i) {
			f.readImportStatement(i)
		}
	}
	for _, c := range f.calls {
		if c.Name == "require" {
			f.readRequire(c)
		}
	}
}

func (f *file) startsStatement(i int) bool {
	return i == 0 || f.toks[i-1].Line < f.toks[i].Line ||
		isPunct(f.toks[i-1], ";") || isPunct(f.toks[i-1], "}")
}

// readImportStatement handles every ESM spelling: default, named, namespace, and
// renames. The names between import and from are the bindings; what follows is
// the module.
func (f *file) readImportStatement(start int) {
	var local, origin []string
	rename := false

	for i := start + 1; i < len(f.toks); i++ {
		t := f.toks[i]
		if t.Kind == lexical.String {
			f.bind(local, origin, t.Text)
			return
		}
		if t.Kind != lexical.Ident {
			continue
		}
		switch {
		case t.Text == "from":
			continue
		case t.Text == "as":
			rename = true
		case rename:
			rename = false
			if n := len(local); n > 0 {
				local[n-1] = t.Text
			}
		default:
			local = append(local, t.Text)
			origin = append(origin, t.Text)
		}
	}
}

// readRequire handles both CommonJS forms: a plain binding, which Assigns
// already found, and a destructured one, which it cannot see past the braces.
func (f *file) readRequire(c lexical.Call) {
	spec, ok := lexical.Str(c.Arg(0))
	if !ok {
		return
	}
	f.framework(spec)

	if c.Start < 2 || !isPunct(f.toks[c.Start-1], "=") {
		return
	}
	if f.toks[c.Start-2].Kind == lexical.Ident {
		name := f.toks[c.Start-2].Text
		f.bind([]string{name}, []string{""}, spec)
		return
	}
	if !isPunct(f.toks[c.Start-2], "}") {
		return
	}
	for i := c.Start - 3; i >= 0; i-- {
		if isPunct(f.toks[i], "{") {
			return
		}
		if f.toks[i].Kind == lexical.Ident {
			f.bind([]string{f.toks[i].Text}, []string{f.toks[i].Text}, spec)
		}
	}
}

func (f *file) bind(local, origin []string, spec string) {
	f.framework(spec)
	relative := strings.HasPrefix(spec, ".")

	for i, name := range local {
		im := imported{name: origin[i]}
		if relative {
			im.spec = spec
		} else {
			im.pkg = spec
		}
		// A namespace or default import has no name inside the module.
		if im.name == name && !relative {
			im.name = ""
		}
		f.imports[name] = im
	}
}

// framework names what a module specifier reveals. NestJS is matched on its
// scope because a controller imports @nestjs/common, never @nestjs/core.
func (f *file) framework(spec string) {
	switch {
	case spec == "express":
		f.note(lang.Express)
	case spec == "fastify":
		f.note(lang.Fastify)
	case strings.HasPrefix(spec, "@nestjs/"):
		f.note(lang.NestJS)
	}
}

// readOwners finds the routers a file declares. An app's routes are already
// absolute; a router's are relative until something mounts it.
func (f *file) readOwners() {
	for _, a := range lexical.Assigns(f.toks) {
		c, ok := lexical.Ctor(a.Value)
		if !ok {
			continue
		}
		switch f.kind(c, a.Value) {
		case rootOwner:
			f.add(&lexical.Owner{Ref: f.ref(a.Name), Root: true})
		case routerOwner:
			f.add(&lexical.Owner{Ref: f.ref(a.Name)})
		}
	}
}

type ownerKind int

const (
	notOwner ownerKind = iota
	rootOwner
	routerOwner
)

func (f *file) kind(c lexical.Call, value []lexical.Token) ownerKind {
	// require("express")() — the import and the call in one expression.
	if c.Name == "require" {
		spec, _ := lexical.Str(c.Arg(0))
		if isApp(spec) && c.End < len(value) && isPunct(value[c.End], "(") {
			return rootOwner
		}
		return notOwner
	}

	recv, method := c.Recv()
	if method == "Router" {
		// express.Router(), or Router() pulled out of the module.
		if f.imports[recv].pkg == "express" || f.imports[method].pkg == "express" {
			return routerOwner
		}
		return notOwner
	}
	if recv == "" && isApp(f.imports[method].pkg) {
		return rootOwner
	}
	return notOwner
}

func isApp(pkg string) bool { return pkg == "express" || pkg == "fastify" }

// readExports marks what the file hands to whoever mounts it, which is how one
// module's routes reach another's prefix.
func (f *file) readExports() {
	for i, t := range f.toks {
		switch {
		case t.Kind == lexical.Ident && t.Text == "export" && f.startsStatement(i):
			f.exportNames(i + 1)
		case t.Kind == lexical.Ident && t.Text == "exports" && i > 0 && isDot(f.toks[i-1]):
			f.exportAssignment(i + 1)
		case t.Kind == lexical.Ident && t.Text == "exports" && i+1 < len(f.toks) && isDot(f.toks[i+1]):
			f.exportAssignment(i + 2)
		}
	}
}

// exportNames marks every owner an export statement names, which is how one
// module's routes reach another module's prefix.
func (f *file) exportNames(from int) {
	if from >= len(f.toks) {
		return
	}
	if isPunct(f.toks[from], "{") {
		for i := from + 1; i < len(f.toks) && !isPunct(f.toks[i], "}"); i++ {
			f.markExported(f.toks[i])
		}
		return
	}
	f.markStatement(from)
}

// exportAssignment handles module.exports = router and exports.router = router.
func (f *file) exportAssignment(from int) {
	for i := from; i < len(f.toks) && i < from+6; i++ {
		if isPunct(f.toks[i], "=") {
			f.markStatement(i + 1)
			return
		}
	}
}

func (f *file) markStatement(from int) {
	if from >= len(f.toks) {
		return
	}
	line := f.toks[from].Line
	for i := from; i < len(f.toks) && f.toks[i].Line == line; i++ {
		f.markExported(f.toks[i])
	}
}

func (f *file) markExported(t lexical.Token) {
	if t.Kind != lexical.Ident {
		return
	}
	if o, ok := f.owners[t.Text]; ok {
		o.Exported = true
	}
}

package lexical

import (
	"path"
	"strings"
)

// Imports resolves a module specifier to a file that was actually indexed,
// which is what lets a mount in one file reach a router declared in another.
type Imports struct{ files map[string]bool }

func NewImports(paths []string) *Imports {
	files := make(map[string]bool, len(paths))
	for _, p := range paths {
		files[p] = true
	}
	return &Imports{files: files}
}

var jsExts = []string{".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"}

// JS resolves a require or import specifier relative to the file it appears in.
// A bare specifier names a package rather than a file, so it never resolves —
// and a router that comes out of a package is not one GritQA can read anyway.
func (im *Imports) JS(from, spec string) (string, bool) {
	if !strings.HasPrefix(spec, ".") {
		return "", false
	}
	return im.find(path.Join(path.Dir(from), spec), jsExts, "index")
}

// Python resolves a module. Leading dots walk up packages the way Python's
// relative imports do; anything else is read from the repo root, then, failing
// that, from anywhere in the tree if exactly one file matches — Django projects
// are usually nested one directory down from where GritQA was pointed.
func (im *Imports) Python(from, module string) (string, bool) {
	up := len(module) - len(strings.TrimLeft(module, "."))
	rel := strings.ReplaceAll(strings.TrimLeft(module, "."), ".", "/")

	if up > 0 {
		base := path.Dir(from)
		for range up - 1 {
			base = path.Dir(base)
		}
		return im.find(path.Join(base, rel), pyExts, "__init__")
	}

	if p, ok := im.find(rel, pyExts, "__init__"); ok {
		return p, true
	}
	return im.only(rel + ".py")
}

var pyExts = []string{".py"}

func (im *Imports) find(base string, exts []string, index string) (string, bool) {
	base = path.Clean(base)
	if base == "." || strings.HasPrefix(base, "..") {
		return "", false
	}
	for _, e := range exts {
		if p := base + e; im.files[p] {
			return p, true
		}
	}
	for _, e := range exts {
		if p := path.Join(base, index+e); im.files[p] {
			return p, true
		}
	}
	return "", false
}

// only returns the single file ending in rel, if there is exactly one. More than
// one is ambiguous, and a wrong prefix is worse than a missing route.
func (im *Imports) only(rel string) (string, bool) {
	var hit string
	n := 0
	for p := range im.files {
		if p == rel || strings.HasSuffix(p, "/"+rel) {
			hit, n = p, n+1
		}
	}
	if n != 1 {
		return "", false
	}
	return hit, true
}

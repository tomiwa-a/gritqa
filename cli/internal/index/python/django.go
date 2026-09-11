package python

import (
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/lang/lexical"
)

// A URLconf is a list, not a router: there is no receiver to gate on and no verb
// to read, so its routes land as ANY and the gate is the shape of the list.
const urlconf = "urlpatterns"

var patternCalls = map[string]bool{"path": true, "re_path": true, "url": true}

func (f *file) readURLPatterns() {
	for i, t := range f.toks {
		if t.Kind != lexical.Ident || t.Text != urlconf || !f.startsStatement(i) {
			continue
		}
		j := i + 1
		if j < len(f.toks) && isPunct(f.toks[j], "+") {
			j++
		}
		if j >= len(f.toks) || !isPunct(f.toks[j], "=") {
			continue
		}
		f.patterns(lexical.Statement(f.toks, j+1))
	}
}

func (f *file) patterns(value []lexical.Token) {
	o := f.add(&lexical.Owner{Ref: f.ref(urlconf)})
	f.note(lang.Django)

	for _, c := range lexical.Calls(value) {
		if !patternCalls[c.Name] {
			continue
		}
		path, known := f.pattern(c)

		if inc, ok := lexical.Ctor(c.Arg(1)); ok && inc.Name == "include" {
			child, spec, ok := f.included(inc)
			if !ok {
				continue
			}
			f.graph.Attach(lexical.Mount{Parent: o.Ref, Child: child, Spec: spec,
				Line: c.Line, Prefix: path, Unresolved: !known})
			continue
		}
		o.Decls = append(o.Decls, lexical.Decl{Path: path, Line: c.Line,
			Handler: handlerOf(c.Arg(1)), Unresolved: !known})
	}
}

// included follows include("api.urls"), which names another file's urlpatterns,
// and include(router.urls), which names a DRF router in this one.
func (f *file) included(c lexical.Call) (lexical.Ref, string, bool) {
	if module, ok := lexical.Str(c.Arg(0)); ok {
		return lexical.Ref{Name: urlconf}, module, true
	}
	arg := c.Arg(0)
	if name := lexical.Name(arg); strings.HasSuffix(name, ".urls") {
		if o, ok := f.owners[strings.TrimSuffix(name, ".urls")]; ok {
			return o.Ref, "", true
		}
	}
	return f.target(arg)
}

// rootURLConf is what makes one URLconf absolute. Django has no root router: the
// project's entry point is named in settings, and without it every urlpatterns
// list is equally unmounted.
func (f *file) rootURLConf(a lexical.Assign) {
	module, ok := lexical.Str(a.Value)
	if !ok {
		return
	}
	f.note(lang.Django)
	root := f.add(&lexical.Owner{Ref: f.ref(a.Name), Root: true})
	f.graph.Attach(lexical.Mount{Parent: root.Ref, Child: lexical.Ref{Name: urlconf},
		Spec: module, Line: a.Line})
}

func (f *file) pattern(c lexical.Call) (string, bool) {
	s, ok := lexical.Str(c.Arg(0))
	if !ok {
		return "/" + lexical.Describe(c.Arg(0)), false
	}
	if c.Name == "path" {
		return convert(s), true
	}
	if p, ok := regexPath(s); ok {
		return p, true
	}
	return "/<regex>", false
}

// regexPath translates the one construct in a re_path worth translating: a named
// group is a path parameter. Anything else left in the pattern means it cannot be
// turned into a path anyone could call, so it is reported instead.
func regexPath(s string) (string, bool) {
	s = strings.TrimSuffix(strings.TrimPrefix(s, "^"), "$")

	var b strings.Builder
	for {
		at := strings.Index(s, "(?P<")
		if at < 0 {
			break
		}
		gt := strings.IndexByte(s[at:], '>')
		end, ok := groupEnd(s, at)
		if gt < 0 || !ok {
			return "", false
		}
		b.WriteString(s[:at])
		b.WriteString(":" + s[at+4:at+gt])
		s = s[end+1:]
	}
	b.WriteString(s)

	out := b.String()
	if strings.ContainsAny(out, `()[]*+?\|`) {
		return "", false
	}
	return out, true
}

func groupEnd(s string, open int) (int, bool) {
	depth := 0
	for i := open; i < len(s); i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			if depth--; depth == 0 {
				return i, true
			}
		}
	}
	return 0, false
}

func handlerOf(arg []lexical.Token) string {
	if n := lexical.Names([][]lexical.Token{arg}); len(n) > 0 {
		return n[0]
	}
	return ""
}

// Package routes holds the endpoint model the dashboard's coverage grid is
// built from, and the framework-agnostic extractor interface.
package routes

import (
	"sort"
	"strings"
)

type Route struct {
	Method     string // GET, POST, PUT, PATCH, DELETE; empty when the source does not say
	Path       string // normalised to :param
	File       string // repo-relative
	Line       int
	Handler    string
	Middleware []string
}

// Signature is the "METHOD /path" form the coverage grid keys on.
func (r Route) Signature() string {
	if r.Method == "" {
		return "ANY " + r.Path
	}
	return r.Method + " " + r.Path
}

// Framework names a supported router.
type Framework string

const (
	Stdlib Framework = "net/http"
	Chi    Framework = "chi"
	Gin    Framework = "gin"
	Echo   Framework = "echo"
	Fiber  Framework = "fiber"
)

// Normalize rewrites a framework's path syntax into the canonical :param form
// the dashboard uses, so chi's {id} and gin's :id land on the same endpoint.
func Normalize(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}

	var b strings.Builder
	for i := 0; i < len(p); {
		if p[i] != '{' {
			b.WriteByte(p[i])
			i++
			continue
		}

		end := strings.IndexByte(p[i:], '}')
		if end < 0 {
			b.WriteString(p[i:])
			break
		}

		inner := p[i+1 : i+end]
		i += end + 1

		// chi allows a regex or a wildcard suffix: {id:[0-9]+}, {rest...}
		if c := strings.IndexByte(inner, ':'); c >= 0 {
			inner = inner[:c]
		}
		if strings.HasSuffix(inner, "...") {
			b.WriteString("*")
			continue
		}
		if inner == "" {
			continue
		}
		b.WriteString(":" + inner)
	}

	out := b.String()
	for strings.Contains(out, "//") {
		out = strings.ReplaceAll(out, "//", "/")
	}
	if !strings.HasPrefix(out, "/") {
		out = "/" + out
	}
	if len(out) > 1 {
		out = strings.TrimRight(out, "/")
	}
	return out
}

// Join concatenates a group prefix with a route pattern.
func Join(prefix, pattern string) string {
	switch {
	case prefix == "" || prefix == "/":
		return Normalize(pattern)
	case pattern == "" || pattern == "/":
		return Normalize(prefix)
	}
	return Normalize(strings.TrimRight(prefix, "/") + "/" + strings.TrimLeft(pattern, "/"))
}

// Sort orders routes by path, then by verb in the order the coverage grid
// reads them, so successive indexes of an unchanged file match byte for byte.
func Sort(rs []Route) {
	sort.SliceStable(rs, func(i, j int) bool {
		if rs[i].Path != rs[j].Path {
			return rs[i].Path < rs[j].Path
		}
		return methodRank(rs[i].Method) < methodRank(rs[j].Method)
	})
}

func methodRank(m string) int {
	for i, v := range verbOrder {
		if v == m {
			return i
		}
	}
	return len(verbOrder)
}

var verbOrder = []string{"GET", "POST", "PUT", "PATCH", "DELETE"}

// Dedupe drops routes sharing a signature, keeping the first.
func Dedupe(rs []Route) []Route {
	seen := make(map[string]struct{}, len(rs))
	out := rs[:0:0]
	for _, r := range rs {
		k := r.File + " " + r.Signature()
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, r)
	}
	return out
}

// canonicalMethods are the verbs the dashboard's MethodBadge renders.
var canonicalMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
}

// Method normalises a verb, returning false for anything the dashboard cannot
// display (HEAD, OPTIONS, and router catch-alls like Any or All).
func Method(s string) (string, bool) {
	up := strings.ToUpper(strings.Trim(s, `"`))
	return up, canonicalMethods[up]
}

// NeedsAuth reports whether any middleware on the route looks like an
// authentication guard — the distinction pillars.tsx surfaces as "which
// endpoints need a logged-in user". It matches on names, because type-checking
// every middleware chain would cost far more than the accuracy is worth.
func (r Route) NeedsAuth() bool {
	for _, m := range r.Middleware {
		lower := strings.ToLower(m)
		for _, hint := range authHints {
			if strings.Contains(lower, hint) {
				return true
			}
		}
	}
	return false
}

var authHints = []string{
	"auth", "jwt", "session", "bearer", "token", "login",
	"protect", "requireuser", "currentuser", "identity",
}

// Extractor pulls routes out of a single file. One per language.
type Extractor interface {
	Language() string
	Handles(path string) bool
	Extract(path string, src []byte) ([]Route, error)
}

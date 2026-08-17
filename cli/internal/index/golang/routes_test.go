package golang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/routes"
)

// The want lists are copied verbatim from COVERAGE_SOURCE in
// web/src/lib/mock/data.ts. If extraction drifts, the coverage grid drifts.
func TestExtractMatchesCoverageShapes(t *testing.T) {
	cases := []struct {
		fixture string
		want    []string
	}{
		{"chi_products.go", []string{
			"GET /products", "POST /products", "GET /products/:id", "PATCH /products/:id",
			"DELETE /products/:id", "GET /products/:id/prices", "POST /products/:id/prices",
			"POST /products/:id/archive", "GET /products/search", "POST /products/bulk",
		}},
		{"gin_orders.go", []string{
			"GET /orders", "POST /orders", "GET /orders/:id", "PATCH /orders/:id",
			"DELETE /orders/:id", "POST /orders/:id/confirm", "POST /orders/:id/cancel",
			"GET /orders/:id/items", "POST /orders/:id/items",
		}},
		{"echo_customers.go", []string{
			"GET /customers", "POST /customers", "GET /customers/:id", "PATCH /customers/:id",
			"DELETE /customers/:id", "GET /customers/:id/orders", "GET /customers/:id/cards",
			"POST /customers/:id/cards", "PUT /customers/:id/cards/:cardId", "POST /customers/import",
		}},
		{"fiber_invoices.go", []string{
			"GET /invoices", "POST /invoices", "GET /invoices/:id", "POST /invoices/:id/send",
			"GET /invoices/:id/pdf", "POST /invoices/:id/void", "GET /invoices/:id/lines",
		}},
	}

	for _, c := range cases {
		t.Run(c.fixture, func(t *testing.T) {
			got := signatures(extract(t, c.fixture))
			if strings.Join(got, "\n") != strings.Join(c.want, "\n") {
				t.Errorf("got:\n  %s\nwant:\n  %s",
					strings.Join(got, "\n  "), strings.Join(c.want, "\n  "))
			}
		})
	}
}

func TestStdlibPatternsCarryTheirVerb(t *testing.T) {
	got := signatures(extract(t, "stdlib_health.go"))
	want := []string{
		"GET /health", "GET /ready", "GET /version",
		"ANY /legacy/ping", "ANY /legacy/metrics",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("got %v, want %v", got, want)
	}
}

// A file importing no known router is skipped entirely, so ordinary Get/Put
// calls on unrelated types cannot be mistaken for endpoints.
func TestFileWithoutAFrameworkYieldsNothing(t *testing.T) {
	rs := extract(t, "no_framework.go")
	if len(rs) != 0 {
		t.Errorf("got %d routes, want 0: %v", len(rs), signatures(rs))
	}
}

func TestMiddlewareIsInheritedThroughNestedScopes(t *testing.T) {
	byPath := map[string][]string{}
	for _, r := range extract(t, "chi_products.go") {
		byPath[r.Signature()] = r.Middleware
	}

	if got := byPath["GET /products"]; len(got) != 1 || got[0] != "middleware.Logger" {
		t.Errorf("GET /products middleware = %v, want [middleware.Logger]", got)
	}

	want := []string{"middleware.Logger", "RequireAuth"}
	got := byPath["GET /products/:id"]
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("GET /products/:id middleware = %v, want %v", got, want)
	}

	// Registered after the /{id} scope closed, so it must not pick up RequireAuth.
	if got := byPath["GET /products/search"]; len(got) != 1 || got[0] != "middleware.Logger" {
		t.Errorf("GET /products/search middleware = %v, want [middleware.Logger]", got)
	}
}

func TestGroupMiddlewareReachesEveryRoute(t *testing.T) {
	for _, r := range extract(t, "gin_orders.go") {
		if len(r.Middleware) != 1 || r.Middleware[0] != "AuthRequired" {
			t.Errorf("%s middleware = %v, want [AuthRequired]", r.Signature(), r.Middleware)
		}
	}
}

func TestHandlerAndLineAreRecorded(t *testing.T) {
	for _, r := range extract(t, "chi_products.go") {
		if r.Handler == "" {
			t.Errorf("%s has no handler", r.Signature())
		}
		if r.Line == 0 {
			t.Errorf("%s has no line number", r.Signature())
		}
		if r.File != "chi_products.go" {
			t.Errorf("%s has file %q", r.Signature(), r.File)
		}
	}
}

func TestFrameworkDetection(t *testing.T) {
	cases := map[string]lang.ID{
		"chi_products.go":   lang.Chi,
		"gin_orders.go":     lang.Gin,
		"echo_customers.go": lang.Echo,
		"fiber_invoices.go": lang.Fiber,
		"stdlib_health.go":  lang.NetHTTP,
	}
	for fixture, want := range cases {
		f := parse(t, fixture)
		found := false
		for _, fw := range f.Frameworks() {
			if fw == want {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: got %v, want it to include %v", fixture, f.Frameworks(), want)
		}
	}

	if fw := parse(t, "no_framework.go").Frameworks(); len(fw) != 0 {
		t.Errorf("got %v, want none", fw)
	}
}

// Shapes that appear in real code but not in the per-framework fixtures.
func TestAssortedRegistrationForms(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want []string
	}{
		{"chained group", `package p
import "github.com/gin-gonic/gin"
func f(r *gin.Engine) { r.Group("/v1").GET("/ping", ping) }`,
			[]string{"GET /v1/ping"}},

		{"chi Method with http constant", `package p
import ("net/http"; "github.com/go-chi/chi/v5")
func f(r chi.Router) { r.Method(http.MethodDelete, "/sessions/{id}", h) }`,
			[]string{"DELETE /sessions/:id"}},

		{"chi With", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router) { r.With(RequireAuth).Get("/me", me) }`,
			[]string{"GET /me"}},

		{"chi middleware-only group", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(RequireAuth)
		r.Get("/admin/audit", audit)
	})
}`,
			[]string{"GET /admin/audit"}},

		{"gin Handle", `package p
import "github.com/gin-gonic/gin"
func f(r *gin.Engine) { r.Handle("POST", "/reports/export", export) }`,
			[]string{"POST /reports/export"}},

		{"path constant", `package p
import "github.com/go-chi/chi/v5"
const base = "/webhooks"
func f(r chi.Router) { r.Post(base+"/stripe", stripe) }`,
			[]string{"POST /webhooks/stripe"}},

		{"registered inside a conditional", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router, debug bool) {
	if debug {
		r.Get("/debug/pprof", pprof)
	}
}`,
			[]string{"GET /debug/pprof"}},

		{"catch-all verbs are dropped", `package p
import "github.com/gin-gonic/gin"
func f(r *gin.Engine) {
	r.Any("/anything", h)
	r.HEAD("/health", h)
	r.OPTIONS("/health", h)
}`,
			nil},

		{"duplicate registration collapses", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router) {
	r.Get("/health", health)
	r.Get("/health", health)
}`,
			[]string{"GET /health"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, err := Parse("x.go", []byte(c.src))
			if err != nil {
				t.Fatal(err)
			}
			got := signatures(found(f))
			if strings.Join(got, "\n") != strings.Join(c.want, "\n") {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestParseReturnsSyntaxErrors(t *testing.T) {
	if _, err := Parse("x.go", []byte("package p\nfunc f( {")); err == nil {
		t.Error("expected a parse error")
	}
}

// A path the walker cannot read is reported, never guessed. The report names the
// expression so there is something to go and fix.
func TestUnresolvablePathsAreReported(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want []string
	}{
		{"prefix from a field", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router, cfg Config) { r.Get(cfg.OrdersPath, list) }`,
			[]string{"GET /<cfg.OrdersPath>"}},

		{"mount poisons its scope", `package p
import "github.com/go-chi/chi/v5"
func f(r chi.Router, base string) {
	r.Route(base, func(r chi.Router) {
		r.Get("/orders", list)
		r.Post("/orders", create)
	})
}`,
			[]string{"GET /<base>/orders", "POST /<base>/orders"}},

		{"verbless registration", `package p
import "net/http"
func f(mux *http.ServeMux, pattern string) { mux.HandleFunc(pattern, ok) }`,
			[]string{"ANY /<pattern>"}},

		{"unnameable expression", `package p
import "github.com/gin-gonic/gin"
func f(r *gin.Engine, paths []string) { r.GET(paths[0], list) }`,
			[]string{"GET /<expr>"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, err := Parse("x.go", []byte(c.src))
			if err != nil {
				t.Fatal(err)
			}
			got, bad := f.Routes()
			if len(got) != 0 {
				t.Errorf("emitted %v, want nothing", signatures(got))
			}
			if s := signatures(bad); strings.Join(s, "\n") != strings.Join(c.want, "\n") {
				t.Errorf("got %v, want %v", s, c.want)
			}
		})
	}
}

// Calls that were never registrations must not turn up in either list.
func TestNonRoutesStayOutOfBothLists(t *testing.T) {
	src := `package p
import "net/http"
func f(url string, body io.Reader) {
	http.Get(url)
	http.Post(url, "application/json", body)
	store.Put("/tmp/session", body)
}`
	f, err := Parse("x.go", []byte(src))
	if err != nil {
		t.Fatal(err)
	}
	if got, bad := f.Routes(); len(got) != 0 || len(bad) != 0 {
		t.Errorf("got %v and %v, want neither", signatures(got), signatures(bad))
	}
}

// A router does not have to arrive as a parameter, so the receiver gate has to
// recognise the other three ways real code holds one.
func TestRoutersHeldOutsideParameters(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want []string
	}{
		{"local constructor", `package p
import "github.com/go-chi/chi/v5"
func main() {
	r := chi.NewRouter()
	r.Get("/health", ok)
}`,
			[]string{"GET /health"}},

		{"struct field", `package p
import "github.com/go-chi/chi/v5"
type Server struct{ mux chi.Router }
func (s *Server) routes() {
	s.mux.Use(RequireAuth)
	s.mux.Get("/me", me)
}`,
			[]string{"GET /me"}},

		{"package var", `package p
import "github.com/gin-gonic/gin"
var engine = gin.Default()
func mount() { engine.GET("/health", ok) }`,
			[]string{"GET /health"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, err := Parse("x.go", []byte(c.src))
			if err != nil {
				t.Fatal(err)
			}
			got := signatures(found(f))
			if strings.Join(got, "\n") != strings.Join(c.want, "\n") {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

func parse(t *testing.T, fixture string) *File {
	t.Helper()
	src, err := os.ReadFile(filepath.Join("testdata", fixture))
	if err != nil {
		t.Fatal(err)
	}
	f, err := Parse(fixture, src)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func extract(t *testing.T, fixture string) []routes.Route {
	t.Helper()
	return found(parse(t, fixture))
}

func found(f *File) []routes.Route {
	rs, _ := f.Routes()
	return rs
}

func signatures(rs []routes.Route) []string {
	if len(rs) == 0 {
		return nil
	}
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Signature()
	}
	return out
}

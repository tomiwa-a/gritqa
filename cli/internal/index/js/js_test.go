package js

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/index/lang"
	"github.com/gritqa/cli/internal/index/lang/lexical"
	"github.com/gritqa/cli/internal/index/routes"
)

// Paths are only absolute once the whole project has been read, so every case
// goes through the same merge-link-resolve the indexer does.
func TestExpressComposesAcrossFiles(t *testing.T) {
	found, unresolved := read(t, "express", lang.Express)

	want := []string{
		"GET /health",
		"GET /status",
		"PUT /status",
		"GET /v1/customers",
		"GET /v1/customers/profile",
		"GET /v1/orders",
		"POST /v1/orders",
		"GET /v1/orders/:id",
		"PATCH /v1/orders/:id",
		"DELETE /v1/orders/:id",
		"ANY /v1/orders/:id/events",
	}
	assert(t, found, want)
	assert(t, unresolved, []string{"POST /v1/customers/<routePath>"})
}

func TestFastifyReadsPluginsAndRouteObjects(t *testing.T) {
	found, unresolved := read(t, "fastify", lang.Fastify)

	want := []string{
		"GET /v1/orders",
		"POST /v1/orders",
		"GET /v1/orders/:id",
		"DELETE /v1/orders/:id",
		"POST /config",
		"PUT /config",
		"GET /health",
		"GET /version",
	}
	assert(t, found, want)

	// The prefix is an expression, so everything the plugin registers is
	// reported rather than given a path nobody can call.
	assert(t, unresolved, []string{"GET /<dynamicPrefix>/invoices"})
}

func TestNestReadsDecorators(t *testing.T) {
	found, unresolved := read(t, "nest", lang.NestJS)

	assert(t, found, []string{
		"GET /orders", "POST /orders", "GET /orders/:id", "DELETE /orders/:id",
	})
	if len(unresolved) != 0 {
		t.Errorf("unresolved = %v", signatures(unresolved))
	}
	if !found[0].NeedsAuth() {
		t.Error("a controller-level @UseGuards(JwtAuthGuard) guards every route on it")
	}
	if found[0].Handler != "list" {
		t.Errorf("handler = %q, want the decorated method", found[0].Handler)
	}
}

// A file full of .get calls that have nothing to do with HTTP yields nothing,
// even in a project that does use Express — the receiver is the gate.
func TestUnrelatedCallsAreNotRoutes(t *testing.T) {
	found, unresolved := read(t, "plain", lang.Express, lang.Fastify)
	if len(found)+len(unresolved) != 0 {
		t.Errorf("got %v / %v, want nothing", signatures(found), signatures(unresolved))
	}
}

func TestMiddlewareReachesRoutesFromEveryLevel(t *testing.T) {
	found, _ := read(t, "express", lang.Express)

	var health, orders routes.Route
	for _, r := range found {
		switch r.Signature() {
		case "GET /health":
			health = r
		case "GET /v1/orders":
			orders = r
		}
	}
	if got := strings.Join(health.Middleware, ","); got != "express.json,requireAuth" {
		t.Errorf("app middleware = %q", got)
	}
	if got := strings.Join(orders.Middleware, ","); got != "express.json,requireAuth,requireAuth" {
		t.Errorf("mounted router middleware = %q", got)
	}
	if !orders.NeedsAuth() {
		t.Error("requireAuth came through the mount")
	}
}

func TestFrameworksComeFromImports(t *testing.T) {
	cases := map[string]lang.ID{
		"express/app.js":            lang.Express,
		"fastify/server.js":         lang.Fastify,
		"nest/orders.controller.ts": lang.NestJS,
	}

	for path, want := range cases {
		src, err := os.ReadFile(filepath.Join("testdata", filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		_, ids := Extract(path, src, nil)
		if len(ids) != 1 || ids[0] != want {
			t.Errorf("%s: got %v, want [%s]", path, ids, want)
		}
	}
}

func read(t *testing.T, dir string, project ...lang.ID) (found, unresolved []routes.Route) {
	t.Helper()

	root := filepath.Join("testdata", dir)
	var paths []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	g := &lexical.Graph{}
	for _, rel := range paths {
		src, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		frag, _ := Extract(rel, src, project)
		g.Merge(frag)
	}
	g.Link(lexical.NewImports(paths))
	return g.Resolve()
}

func assert(t *testing.T, got []routes.Route, want []string) {
	t.Helper()
	if a, b := signatures(got), want; strings.Join(a, "\n") != strings.Join(b, "\n") {
		t.Errorf("got:\n  %s\nwant:\n  %s",
			strings.Join(a, "\n  "), strings.Join(b, "\n  "))
	}
}

func signatures(rs []routes.Route) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Signature()
	}
	return out
}

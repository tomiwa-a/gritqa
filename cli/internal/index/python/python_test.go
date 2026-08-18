package python

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
func TestFastAPIComposesAcrossModules(t *testing.T) {
	found, unresolved := read(t, "fastapi")

	want := []string{
		"GET /health",
		"GET /v1/customers",
		"GET /v1/customers/profile",
		"GET /v1/orders",
		"POST /v1/orders",
		"GET /v1/orders/:order_id",
		"DELETE /v1/orders/:order_id",
	}
	assert(t, found, want)
	assert(t, unresolved, []string{"PUT /v1/customers/<settings.profile_path>"})
}

// register_blueprint's url_prefix replaces the blueprint's own instead of
// composing with it, so /orders registered under /v1/orders is not /v1/orders/orders.
func TestFlaskBlueprintPrefixIsOverridden(t *testing.T) {
	found, unresolved := read(t, "flask")

	want := []string{
		"GET /health",
		"ANY /health/ready", // methods came from a name, so the verb is unknown
		"GET /v1/orders",
		"POST /v1/orders",
		"GET /v1/orders/:order_id",
		"GET /v1/orders/:order_id/events",
	}
	assert(t, found, want)
	assert(t, unresolved, nil)
}

func TestDjangoResolvesFromRootURLConf(t *testing.T) {
	found, unresolved := read(t, "django")

	want := []string{
		"ANY /v1/customers/:pk",
		"ANY /v1/health",
		"ANY /v1/legacy/invoices/:invoice_id",
		"GET /v1/orders",
		"POST /v1/orders",
		"GET /v1/orders/:pk",
		"PUT /v1/orders/:pk",
		"PATCH /v1/orders/:pk",
		"DELETE /v1/orders/:pk",
	}
	assert(t, found, want)
	// A regex with an alternation in it is not a path anyone can call.
	assert(t, unresolved, []string{"ANY /v1/<regex>"})
}

// The receiver is what carries precision here: drop the module check on the
// constructor and a local class sharing a framework's name invents four
// endpoints, which is what the Blueprint in this fixture pins.
func TestUnrelatedCallsAreNotRoutes(t *testing.T) {
	found, unresolved := read(t, "plain")
	assert(t, found, nil)
	assert(t, unresolved, nil)
}

func TestDependenciesReachRoutesFromBothLevels(t *testing.T) {
	found, _ := read(t, "fastapi")

	var orders, customers routes.Route
	for _, r := range found {
		switch r.Signature() {
		case "GET /v1/orders":
			orders = r
		case "GET /v1/customers":
			customers = r
		}
	}

	if got := strings.Join(orders.Middleware, ","); got != "require_auth" {
		t.Errorf("router dependencies = %q", got)
	}
	if !orders.NeedsAuth() {
		t.Error("a router-level Depends still guards its routes")
	}
	if got := strings.Join(customers.Middleware, ","); got != "require_admin" {
		t.Errorf("mount dependencies = %q", got)
	}
}

func TestFrameworksComeFromImports(t *testing.T) {
	cases := map[string]lang.ID{
		"fastapi/main.py":    lang.FastAPI,
		"flask/app.py":       lang.Flask,
		"django/api/urls.py": lang.Django,
	}

	for path, want := range cases {
		src, err := os.ReadFile(filepath.Join("testdata", filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		_, ids := Extract(path, src)
		if len(ids) != 1 || ids[0] != want {
			t.Errorf("%s: got %v, want [%s]", path, ids, want)
		}
	}
}

func read(t *testing.T, dir string) (found, unresolved []routes.Route) {
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
		frag, _ := Extract(rel, src)
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

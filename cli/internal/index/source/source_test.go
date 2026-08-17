package source

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/index/routes"
)

func TestListIsTheEscapeHatch(t *testing.T) {
	res, err := Resolve(t.TempDir(), []string{"POST /orders", "get /orders/{id}"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != List {
		t.Errorf("kind = %q, want %q", res.Kind, List)
	}
	if got := sigs(res.Routes); strings.Join(got, "\n") != "POST /orders\nGET /orders/:id" {
		t.Errorf("got %v", got)
	}
	if res.Routes[0].File != configFile || res.Routes[0].Line == 0 {
		t.Errorf("entries should point back at the config: %+v", res.Routes[0])
	}
}

func TestListRejectsEntriesItCannotRead(t *testing.T) {
	for _, entry := range []string{"/orders", "FETCH /orders"} {
		if _, err := Resolve(t.TempDir(), []string{entry}, ""); err == nil {
			t.Errorf("%q was accepted", entry)
		}
	}
}

// The list is source 1, so it wins even when a spec sits right there.
func TestListOutranksSpec(t *testing.T) {
	root := repo(t, map[string]string{"openapi.yaml": openAPI3})

	res, err := Resolve(root, []string{"GET /only"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != List || len(res.Routes) != 1 {
		t.Errorf("got %q with %d routes", res.Kind, len(res.Routes))
	}
}

func TestSpecIsFoundWithoutBeingConfigured(t *testing.T) {
	root := repo(t, map[string]string{"docs/openapi.yaml": openAPI3})

	res, err := Resolve(root, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != Spec || res.Detail != "docs/openapi.yaml" {
		t.Fatalf("kind = %q, detail = %q", res.Kind, res.Detail)
	}

	// servers[0].url carries /v1, so every path has to move under it.
	want := []string{"GET /v1/orders", "POST /v1/orders", "GET /v1/orders/:id"}
	if got := sigs(res.Routes); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("got %v, want %v", got, want)
	}

	for _, r := range res.Routes {
		if r.File != "docs/openapi.yaml" || r.Line == 0 {
			t.Errorf("%s has no source position: %+v", r.Signature(), r)
		}
	}
}

// A spec-only project still has to answer "which endpoints need a logged-in
// user", and its security requirements are the only thing that can.
func TestSpecSecurityBecomesMiddleware(t *testing.T) {
	root := repo(t, map[string]string{"openapi.yaml": openAPI3})

	res, err := Resolve(root, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	guarded := map[string]bool{}
	for _, r := range res.Routes {
		guarded[r.Signature()] = r.NeedsAuth()
	}
	if !guarded["POST /v1/orders"] {
		t.Error("POST /v1/orders declares bearerAuth")
	}
	if guarded["GET /v1/orders"] {
		t.Error("GET /v1/orders opts out with security: []")
	}
}

func TestSwagger2BasePath(t *testing.T) {
	root := repo(t, map[string]string{"swagger.json": swagger2})

	res, err := Resolve(root, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := sigs(res.Routes); strings.Join(got, "\n") != "GET /api/v2/customers" {
		t.Errorf("got %v", got)
	}
}

func TestConfiguredSpecMustExistAndDeclarePaths(t *testing.T) {
	root := repo(t, map[string]string{"api/empty.yaml": "openapi: 3.0.0\npaths: {}\n"})

	if _, err := Resolve(root, nil, "api/missing.yaml"); err == nil {
		t.Error("a spec the user named and that is not there is an error")
	}
	if _, err := Resolve(root, nil, "api/empty.yaml"); err == nil {
		t.Error("a spec the user named that declares nothing is an error")
	}
}

// An unconfigured spec that turns out to be useless falls through to the next
// source rather than failing the index.
func TestDiscoveredSpecWithNoPathsFallsThrough(t *testing.T) {
	root := repo(t, map[string]string{"openapi.yaml": "openapi: 3.0.0\npaths: {}\n"})

	res, err := Resolve(root, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Empty() {
		t.Errorf("got %q, want the ladder to keep going", res.Kind)
	}
}

func TestNoSourceAtAll(t *testing.T) {
	res, err := Resolve(t.TempDir(), nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Empty() {
		t.Errorf("got %q, want none", res.Kind)
	}
}

const openAPI3 = `openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
security:
  - bearerAuth: []
paths:
  /orders:
    get:
      operationId: listOrders
      security: []
    post:
      operationId: createOrder
  /orders/{id}:
    get:
      operationId: getOrder
    trace:
      operationId: ignored
`

const swagger2 = `{
  "swagger": "2.0",
  "basePath": "/api/v2",
  "paths": {"/customers": {"get": {"operationId": "listCustomers"}}}
}`

func repo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func sigs(rs []routes.Route) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Signature()
	}
	return out
}

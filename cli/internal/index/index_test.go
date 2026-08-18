package index

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/index/source"
)

func TestReadIndexesGoSourceAndItsRoutes(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod": "module example.com/api\n",
		"routes/products.go": `package routes

import "github.com/go-chi/chi/v5"

func Products(r chi.Router, h *H) {
	r.Route("/products", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
	})
}
`,
		"routes/health.go": `package routes

import "net/http"

func Health(mux *http.ServeMux) {
	mux.HandleFunc("GET /health", ok)
}
`,
		"internal/store/store.go": "package store\n\ntype Store struct{}\n",
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if snap.FileCount() != 3 {
		t.Errorf("file count = %d, want 3: %v", snap.FileCount(), paths(snap))
	}
	if snap.EndpointCount() != 3 {
		t.Errorf("endpoint count = %d, want 3: %v", snap.EndpointCount(), sigs(snap))
	}

	for _, f := range snap.Files {
		if f.Hash == "" || f.Size == 0 {
			t.Errorf("%s not hashed: %+v", f.Path, f)
		}
		if f.Language != "go" {
			t.Errorf("%s language = %q", f.Path, f.Language)
		}
	}
}

// go.mod, README and lockfiles are not application code and must not inflate the
// file count the dashboard shows.
func TestReadSkipsNonSourceAndVendoredTrees(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod":                  "module example.com/api\n",
		"README.md":               "# api\n",
		"docker-compose.yml":      "services: {}\n",
		"main.go":                 "package main\n\nfunc main() {}\n",
		"vendor/x/y/y.go":         "package y\n",
		"node_modules/z/index.js": "module.exports = 1\n",
		"web/dist/bundle.js":      "var a=1\n",
		".gritqa/cache.db":        "not a real db\n",
		"internal/handler/api.py": "def handler(): pass\n",
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"internal/handler/api.py", "main.go"}
	if got := paths(snap); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestReadSkipsRoutesInTestFiles(t *testing.T) {
	root := newProject(t, map[string]string{
		"api_test.go": `package api

import "net/http"

func TestX(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/only", ok)
}
`,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if snap.FileCount() != 1 {
		t.Errorf("file count = %d, want 1", snap.FileCount())
	}
	if snap.EndpointCount() != 0 {
		t.Errorf("got %v, want no endpoints from a test file", sigs(snap))
	}
}

func TestReadReportsFrameworksAndUnparseableFiles(t *testing.T) {
	root := newProject(t, map[string]string{
		"a.go": "package a\n\nimport \"github.com/gin-gonic/gin\"\n\nfunc f(r *gin.Engine) { r.GET(\"/x\", h) }\n",
		"b.go": "package b\n\nfunc f( {\n",
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Frameworks) != 1 || string(snap.Frameworks[0]) != "gin" {
		t.Errorf("frameworks = %v, want [gin]", snap.Frameworks)
	}
	if len(snap.Unparsed) != 1 || snap.Unparsed[0] != "b.go" {
		t.Errorf("unparsed = %v, want [b.go]", snap.Unparsed)
	}
}

func TestReadIsDeterministic(t *testing.T) {
	root := newProject(t, map[string]string{
		"a.go": "package a\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/a\", h) }\n",
		"b.go": "package b\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/b\", h) }\n",
		"c.go": "package c\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/c\", h) }\n",
	})

	first, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		next, err := Read(context.Background(), root, Options{})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(paths(next), ",") != strings.Join(paths(first), ",") {
			t.Fatalf("file order drifted: %v then %v", paths(first), paths(next))
		}
		if strings.Join(sigs(next), ",") != strings.Join(sigs(first), ",") {
			t.Fatalf("route order drifted: %v then %v", sigs(first), sigs(next))
		}
	}
}

func TestByFileGroupsEndpoints(t *testing.T) {
	root := newProject(t, map[string]string{
		"a.go": "package a\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/a\", h); r.Post(\"/a\", h) }\n",
		"b.go": "package b\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/b\", h) }\n",
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	groups := snap.ByFile()
	if len(groups) != 2 {
		t.Fatalf("got %d groups, want 2", len(groups))
	}
	if groups[0].File != "a.go" || len(groups[0].Routes) != 2 {
		t.Errorf("group 0 = %s with %d routes", groups[0].File, len(groups[0].Routes))
	}
	if groups[1].File != "b.go" || len(groups[1].Routes) != 1 {
		t.Errorf("group 1 = %s with %d routes", groups[1].File, len(groups[1].Routes))
	}
}

func TestDiff(t *testing.T) {
	before := map[string]string{"a.go": "1", "b.go": "2", "gone.go": "3"}
	after := map[string]string{"a.go": "1", "b.go": "changed", "new.go": "4"}

	d := Diff(before, after)
	if strings.Join(d.Added, ",") != "new.go" {
		t.Errorf("added = %v", d.Added)
	}
	if strings.Join(d.Changed, ",") != "b.go" {
		t.Errorf("changed = %v", d.Changed)
	}
	if strings.Join(d.Removed, ",") != "gone.go" {
		t.Errorf("removed = %v", d.Removed)
	}
	if d.Empty() || d.Count() != 3 {
		t.Errorf("Empty=%v Count=%d", d.Empty(), d.Count())
	}

	if !Diff(before, before).Empty() {
		t.Error("an unchanged tree should produce an empty delta")
	}
}

func TestLargeFilesAreCountedButNotParsed(t *testing.T) {
	root := t.TempDir()
	big := strings.Repeat("// generated\n", (maxFileSize/13)+100)
	write(t, filepath.Join(root, "generated.go"), "package a\n"+big)

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if snap.FileCount() != 1 {
		t.Fatalf("file count = %d, want 1", snap.FileCount())
	}
	if snap.Files[0].Hash != "" {
		t.Error("an oversized file should not be hashed")
	}
	if snap.Files[0].Size <= maxFileSize {
		t.Errorf("size = %d", snap.Files[0].Size)
	}
}

func TestLanguage(t *testing.T) {
	cases := map[string]string{
		"a.go": "go", "a.GO": "go", "a.ts": "typescript", "a.tsx": "typescript",
		"a.py": "python", "a.sql": "sql", "a.md": "", "go.mod": "", "Makefile": "",
	}
	for in, want := range cases {
		if got := Language(in); got != want {
			t.Errorf("Language(%q) = %q, want %q", in, got, want)
		}
	}
}

func newProject(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		write(t, filepath.Join(root, filepath.FromSlash(rel)), body)
	}
	return root
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func paths(s *Snapshot) []string {
	out := make([]string, len(s.Files))
	for i, f := range s.Files {
		out[i] = f.Path
	}
	return out
}

func sigs(s *Snapshot) []string       { return each(s.Routes) }
func unresolved(s *Snapshot) []string { return each(s.Unresolved) }

func each(rs []routes.Route) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.File + " " + r.Signature()
	}
	return out
}

// Two languages, one index. Express needs a project-wide pass to finish its
// paths, and the result still has to be grouped by file for the coverage grid.
func TestReadComposesLexicalRoutesAcrossFiles(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod":       "module example.com/api\n",
		"package.json": `{"dependencies": {"express": "^4.19.0"}}`,

		"cmd/api/main.go": `package main

import "net/http"

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", ok)
}
`,
		"src/app.js": `const express = require('express');
const orders = require('./routes/orders');

const app = express();
app.use('/v1/orders', orders);
app.get('/health', handleHealth);
`,
		"src/routes/orders.js": `const { Router } = require('express');

const router = Router();
router.get('/', list);
router.post('/', create);

module.exports = router;
`,
		// A fixture app in a test registers a route that is not the project's.
		"src/app.test.js": `const express = require('express');

const app = express();
app.get('/internal/only', handler);
`,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	want := []string{
		"cmd/api/main.go GET /metrics",
		"src/app.js GET /health",
		"src/routes/orders.js GET /v1/orders",
		"src/routes/orders.js POST /v1/orders",
	}
	if got := sigs(snap); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("got:\n  %s\nwant:\n  %s",
			strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
	if got := snap.Frameworks; len(got) != 2 || got[0] != "net/http" || got[1] != "express" {
		t.Errorf("frameworks = %v, want [net/http express]", got)
	}
	if snap.Source != source.Static {
		t.Errorf("source = %q, want static", snap.Source)
	}
}

// Python takes the same route through the indexer, and a router nothing mounts
// is reported rather than silently dropped.
func TestReadReportsPythonRoutesItCouldNotMount(t *testing.T) {
	root := newProject(t, map[string]string{
		"requirements.txt": "fastapi==0.111.0\n",

		"main.py": `from fastapi import FastAPI
from .routers import orders

app = FastAPI()
app.include_router(orders.router, prefix="/v1")
`,
		"routers/orders.py": `from fastapi import APIRouter

router = APIRouter(prefix="/orders")

@router.get("")
def list_orders():
    return []
`,
		"routers/drafts.py": `from fastapi import APIRouter

router = APIRouter(prefix="/drafts")

@router.get("")
def list_drafts():
    return []
`,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if got := sigs(snap); strings.Join(got, "\n") != "routers/orders.py GET /v1/orders" {
		t.Errorf("got %v", got)
	}
	want := "routers/drafts.py GET /<router>/drafts"
	if got := unresolved(snap); strings.Join(got, "\n") != want {
		t.Errorf("unresolved = %v, want %q", got, want)
	}
}

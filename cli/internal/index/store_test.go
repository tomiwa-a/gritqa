package index

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreRoundTripsASnapshot(t *testing.T) {
	root := newProject(t, map[string]string{
		"routes/products.go": `package routes

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func Products(r chi.Router, h *H) {
	r.Route("/products", func(r chi.Router) {
		r.Use(middleware.Logger)
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Get("/{id}", h.Get)
	})
}
`,
	})

	snap, err := Read(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}

	s := open(t, root)
	if err := s.Save(snap); err != nil {
		t.Fatal(err)
	}

	got, err := s.Load(root)
	if err != nil {
		t.Fatal(err)
	}

	if strings.Join(paths(got), ",") != strings.Join(paths(snap), ",") {
		t.Errorf("files: got %v, want %v", paths(got), paths(snap))
	}
	if strings.Join(sigs(got), ",") != strings.Join(sigs(snap), ",") {
		t.Errorf("routes: got %v, want %v", sigs(got), sigs(snap))
	}

	for i, r := range got.Routes {
		want := snap.Routes[i]
		if r.Line != want.Line || r.Handler != want.Handler {
			t.Errorf("%s: got line %d handler %q, want %d %q",
				r.Signature(), r.Line, r.Handler, want.Line, want.Handler)
		}
		if strings.Join(r.Middleware, ",") != strings.Join(want.Middleware, ",") {
			t.Errorf("%s middleware: got %v, want %v", r.Signature(), r.Middleware, want.Middleware)
		}
	}

	if n := got.Files[0].Symbols["func"]; n != 1 {
		t.Errorf("symbol counts were lost: %v", got.Files[0].Symbols)
	}
}

func TestStoreHashesDriveChangeDetection(t *testing.T) {
	root := newProject(t, map[string]string{"a.go": "package a\n"})

	s := open(t, root)
	before, err := s.Hashes()
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != 0 {
		t.Errorf("a fresh cache should be empty, got %v", before)
	}

	first, err := Read(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(first); err != nil {
		t.Fatal(err)
	}

	// Nothing touched.
	stored, err := s.Hashes()
	if err != nil {
		t.Fatal(err)
	}
	if !Diff(stored, first.Hashes()).Empty() {
		t.Error("an unchanged tree should produce an empty delta against the cache")
	}

	write(t, filepath.Join(root, "a.go"), "package a\n\nvar X = 1\n")
	write(t, filepath.Join(root, "b.go"), "package a\n")

	second, err := Read(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}

	d := Diff(stored, second.Hashes())
	if strings.Join(d.Changed, ",") != "a.go" {
		t.Errorf("changed = %v, want [a.go]", d.Changed)
	}
	if strings.Join(d.Added, ",") != "b.go" {
		t.Errorf("added = %v, want [b.go]", d.Added)
	}
}

// Save replaces rather than accumulates, so removed files leave no ghosts.
func TestSaveIsAReplacement(t *testing.T) {
	root := newProject(t, map[string]string{
		"a.go": "package a\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/a\", h) }\n",
		"b.go": "package b\n\nimport \"github.com/go-chi/chi/v5\"\n\nfunc f(r chi.Router) { r.Get(\"/b\", h) }\n",
	})

	s := open(t, root)
	first, err := Read(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(first); err != nil {
		t.Fatal(err)
	}

	trimmed := &Snapshot{Root: root, Files: first.Files[:1], Routes: first.Routes[:1]}
	if err := s.Save(trimmed); err != nil {
		t.Fatal(err)
	}

	got, err := s.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Files) != 1 || len(got.Routes) != 1 {
		t.Errorf("got %d files and %d routes, want 1 and 1", len(got.Files), len(got.Routes))
	}
}

func TestLastIndexedIsZeroBeforeTheFirstSave(t *testing.T) {
	root := t.TempDir()
	s := open(t, root)

	at, err := s.LastIndexed()
	if err != nil {
		t.Fatal(err)
	}
	if !at.IsZero() {
		t.Errorf("got %v, want the zero time", at)
	}

	if err := s.Save(&Snapshot{Root: root}); err != nil {
		t.Fatal(err)
	}
	at, err = s.LastIndexed()
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(at) > time.Minute {
		t.Errorf("got %v", at)
	}
}

func TestMeta(t *testing.T) {
	s := open(t, t.TempDir())

	if v, err := s.Meta("missing"); err != nil || v != "" {
		t.Errorf("got (%q, %v), want (\"\", nil)", v, err)
	}
	if err := s.SetMeta("revision", "7"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.Meta("revision"); v != "7" {
		t.Errorf("got %q, want 7", v)
	}
	if err := s.SetMeta("revision", "8"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.Meta("revision"); v != "8" {
		t.Errorf("got %q, want 8", v)
	}
}

// The cache is disposable: a schema bump rebuilds it instead of migrating.
func TestSchemaBumpRebuildsTheCache(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".gritqa", "cache.db")

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(&Snapshot{Root: root, Files: []File{{Path: "a.go", Language: "go", Hash: "x"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMeta("schema_version", "0"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()

	h, err := reopened.Hashes()
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 0 {
		t.Errorf("got %v, want a rebuilt cache", h)
	}
}

func open(t *testing.T, root string) *Store {
	t.Helper()
	s, err := Open(filepath.Join(root, ".gritqa", "cache.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

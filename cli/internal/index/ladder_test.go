package index

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/index/lang"
	"github.com/tomiwa-a/gritqa/cli/internal/index/source"
)

// A project GritQA cannot parse still gets a real coverage grid, as long as it
// ships a spec.
func TestSpecCarriesAProjectStaticExtractionCannotRead(t *testing.T) {
	root := newProject(t, map[string]string{
		"Gemfile":      "gem 'rails', '~> 7.1'\n",
		"app.rb":       "class OrdersController < ApplicationController\nend\n",
		"openapi.yaml": specWithOrders,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if snap.Source != source.Spec || snap.SourceDetail != "openapi.yaml" {
		t.Errorf("source = %q (%q)", snap.Source, snap.SourceDetail)
	}
	if got := endpoints(snap); strings.Join(got, "\n") != "GET /orders\nPOST /orders" {
		t.Errorf("got %v", got)
	}
	if !contains(snap.Frameworks, lang.Rails) {
		t.Errorf("frameworks = %v, want rails from the Gemfile", snap.Frameworks)
	}
}

func TestConfiguredListOutranksTheSourceItCouldHaveRead(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod": "module example.com/api\n",
		"api.go": `package api

import "github.com/go-chi/chi/v5"

func Mount(r chi.Router) { r.Get("/ignored", h) }
`,
	})

	snap, err := Read(context.Background(), root, Options{List: []string{"GET /orders"}})
	if err != nil {
		t.Fatal(err)
	}

	if snap.Source != source.List {
		t.Errorf("source = %q, want %q", snap.Source, source.List)
	}
	if got := endpoints(snap); strings.Join(got, "\n") != "GET /orders" {
		t.Errorf("got %v", got)
	}
	// The file pass still ran: hashes and change detection do not depend on
	// where the endpoints came from.
	if snap.FileCount() != 1 || snap.Files[0].Hash == "" {
		t.Errorf("files = %v", paths(snap))
	}
}

// The honest answer for a project with no spec, no list and no parseable
// framework is "I know what this is and cannot read it", not zero endpoints.
func TestUnreadableProjectWithNoSpecReportsWhatItIs(t *testing.T) {
	root := newProject(t, map[string]string{
		"Gemfile": "gem 'rails', '~> 7.1'\n",
		"app.rb":  "class OrdersController < ApplicationController\nend\n",
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if snap.Source != source.None || snap.EndpointCount() != 0 {
		t.Errorf("source = %q with %d endpoints", snap.Source, snap.EndpointCount())
	}
	if !contains(snap.Frameworks, lang.Rails) {
		t.Errorf("frameworks = %v, want rails", snap.Frameworks)
	}
	if lang.Readable(snap.Frameworks) {
		t.Error("rails is not readable from source yet")
	}
}

func TestStaticExtractionIsStillTheDefault(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod": "module example.com/api\n",
		"api.go": `package api

import "github.com/gin-gonic/gin"

func Mount(r *gin.Engine) { r.GET("/health", ok) }
`,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if snap.Source != source.Static {
		t.Errorf("source = %q, want %q", snap.Source, source.Static)
	}
	if got := endpoints(snap); strings.Join(got, "\n") != "GET /health" {
		t.Errorf("got %v", got)
	}
	if !contains(snap.Frameworks, lang.Gin) {
		t.Errorf("frameworks = %v, want gin", snap.Frameworks)
	}
}

// A mount whose prefix cannot be followed makes every route under it a guess.
// Those are reported, never shown as endpoints.
func TestUnresolvedRoutesAreReportedNotCounted(t *testing.T) {
	root := newProject(t, map[string]string{
		"go.mod": "module example.com/api\n",
		"api.go": `package api

import "github.com/go-chi/chi/v5"

func Mount(r chi.Router, cfg Config) {
	r.Get("/health", ok)
	r.Route(cfg.Prefix, func(r chi.Router) {
		r.Get("/orders", listOrders)
	})
}
`,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	if got := endpoints(snap); strings.Join(got, "\n") != "GET /health" {
		t.Errorf("endpoints = %v, want only the resolvable one", got)
	}
	if snap.UnresolvedCount() != 1 {
		t.Fatalf("unresolved = %d, want 1", snap.UnresolvedCount())
	}
	if got := snap.Unresolved[0].Signature(); got != "GET /<cfg.Prefix>/orders" {
		t.Errorf("unresolved = %q, want it to name the expression", got)
	}
}

// The cache stores both lists and the source that produced them, so a run over
// an unchanged tree reports exactly what the first one did.
func TestCacheRoundTripsSourceAndUnresolved(t *testing.T) {
	root := newProject(t, map[string]string{
		"Gemfile":      "gem 'rails', '~> 7.1'\n",
		"openapi.yaml": specWithOrders,
	})

	snap, err := Read(context.Background(), root, Options{})
	if err != nil {
		t.Fatal(err)
	}

	store, err := Open(filepath.Join(root, ".gritqa", "cache.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if err := store.Save(snap); err != nil {
		t.Fatal(err)
	}
	back, err := store.Load(root)
	if err != nil {
		t.Fatal(err)
	}

	if back.Source != snap.Source || back.SourceDetail != snap.SourceDetail {
		t.Errorf("source = %q (%q), want %q (%q)",
			back.Source, back.SourceDetail, snap.Source, snap.SourceDetail)
	}
	if strings.Join(endpoints(back), "\n") != strings.Join(endpoints(snap), "\n") {
		t.Errorf("endpoints = %v, want %v", endpoints(back), endpoints(snap))
	}
	if !contains(back.Frameworks, lang.Rails) {
		t.Errorf("frameworks = %v, want rails", back.Frameworks)
	}
}

const specWithOrders = `openapi: 3.0.0
paths:
  /orders:
    get: {operationId: listOrders}
    post: {operationId: createOrder}
`

func contains(ids []lang.ID, want lang.ID) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func endpoints(s *Snapshot) []string {
	out := make([]string, len(s.Routes))
	for i, r := range s.Routes {
		out[i] = r.Signature()
	}
	return out
}

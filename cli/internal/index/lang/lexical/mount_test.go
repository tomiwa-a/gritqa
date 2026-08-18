package lexical

import (
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/index/routes"
)

func TestMountsComposeAcrossFiles(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "app.js", Name: "app"}, Root: true})
	g.Add(&Owner{
		Ref:      Ref{File: "routes/orders.js", Name: "router"},
		Exported: true,
		Decls: []Decl{
			{Method: "GET", Path: "/", Line: 4, Handler: "list"},
			{Method: "GET", Path: "/:id", Line: 5, Handler: "get"},
		},
	})
	g.Attach(Mount{
		Parent: Ref{File: "app.js", Name: "app"},
		Child:  Ref{File: "routes/orders.js"},
		Prefix: "/v1/orders",
	})

	found, unresolved := g.Resolve()
	if got := sigs(found); strings.Join(got, "\n") != "GET /v1/orders\nGET /v1/orders/:id" {
		t.Errorf("got %v", got)
	}
	if len(unresolved) != 0 {
		t.Errorf("unresolved = %v", sigs(unresolved))
	}
	if found[0].File != "routes/orders.js" || found[0].Line != 4 {
		t.Errorf("routes should point at the file that declared them: %+v", found[0])
	}
}

// A router's own prefix composes with the prefix it is mounted at.
func TestOwnPrefixAndMountPrefixBothApply(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "main.py", Name: "app"}, Root: true})
	g.Add(&Owner{
		Ref:    Ref{File: "orders.py", Name: "router"},
		Prefix: "/orders",
		Decls:  []Decl{{Method: "GET", Path: "/", Line: 9}},
	})
	g.Attach(Mount{
		Parent: Ref{File: "main.py", Name: "app"},
		Child:  Ref{File: "orders.py", Name: "router"},
		Prefix: "/v1",
	})

	found, _ := g.Resolve()
	if got := sigs(found); strings.Join(got, "\n") != "GET /v1/orders" {
		t.Errorf("got %v", got)
	}
}

// The same router mounted twice is two sets of endpoints, not a conflict.
func TestARouterMountedTwiceYieldsBothPaths(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "app.js", Name: "app"}, Root: true})
	g.Add(&Owner{
		Ref:   Ref{File: "orders.js", Name: "router"},
		Decls: []Decl{{Method: "GET", Path: "/orders"}},
	})
	for _, prefix := range []string{"/v1", "/v2"} {
		g.Attach(Mount{
			Parent: Ref{File: "app.js", Name: "app"},
			Child:  Ref{File: "orders.js", Name: "router"},
			Prefix: prefix,
		})
	}

	found, _ := g.Resolve()
	if got := sigs(found); strings.Join(got, "\n") != "GET /v1/orders\nGET /v2/orders" {
		t.Errorf("got %v", got)
	}
}

// An unmounted router's routes are real but have no callable path, so they are
// reported with a marker naming the router to go and mount.
func TestUnmountedRouterIsReported(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{
		Ref:   Ref{File: "orders.js", Name: "router"},
		Decls: []Decl{{Method: "GET", Path: "/orders"}},
	})

	found, unresolved := g.Resolve()
	if len(found) != 0 {
		t.Errorf("emitted %v, want nothing", sigs(found))
	}
	if got := sigs(unresolved); strings.Join(got, "\n") != "GET /<router>/orders" {
		t.Errorf("got %v", got)
	}
}

// An unreadable prefix anywhere above a route poisons everything under it.
func TestUnreadableMountPoisonsTheSubtree(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "app.js", Name: "app"}, Root: true})
	g.Add(&Owner{
		Ref:   Ref{File: "orders.js", Name: "router"},
		Decls: []Decl{{Method: "GET", Path: "/orders"}, {Method: "POST", Path: "/orders"}},
	})
	g.Attach(Mount{
		Parent:     Ref{File: "app.js", Name: "app"},
		Child:      Ref{File: "orders.js", Name: "router"},
		Prefix:     "/<cfg.prefix>",
		Unresolved: true,
	})

	found, unresolved := g.Resolve()
	if len(found) != 0 {
		t.Errorf("emitted %v, want nothing", sigs(found))
	}
	if len(unresolved) != 2 {
		t.Errorf("got %v", sigs(unresolved))
	}
}

func TestMiddlewareAccumulatesDownTheGraph(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "app.js", Name: "app"}, Root: true, Middleware: []string{"logger"}})
	g.Add(&Owner{
		Ref:        Ref{File: "orders.js", Name: "router"},
		Middleware: []string{"requireAuth"},
		Decls:      []Decl{{Method: "GET", Path: "/orders", Middleware: []string{"cache"}}},
	})
	g.Attach(Mount{
		Parent:     Ref{File: "app.js", Name: "app"},
		Child:      Ref{File: "orders.js", Name: "router"},
		Prefix:     "/v1",
		Middleware: []string{"rateLimit"},
	})

	found, _ := g.Resolve()
	want := "logger,rateLimit,requireAuth,cache"
	if got := strings.Join(found[0].Middleware, ","); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if !found[0].NeedsAuth() {
		t.Error("requireAuth came from the router, and still counts")
	}
}

func TestMountCyclesTerminate(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "a.js", Name: "app"}, Root: true})
	g.Add(&Owner{Ref: Ref{File: "b.js", Name: "b"}, Decls: []Decl{{Method: "GET", Path: "/b"}}})
	g.Attach(Mount{Parent: Ref{File: "a.js", Name: "app"}, Child: Ref{File: "b.js", Name: "b"}, Prefix: "/b"})
	g.Attach(Mount{Parent: Ref{File: "b.js", Name: "b"}, Child: Ref{File: "a.js", Name: "app"}})

	found, _ := g.Resolve()
	if got := sigs(found); strings.Join(got, "\n") != "GET /b/b" {
		t.Errorf("got %v", got)
	}
}

// A file's export is found without being named, since that is how one module
// mounts another.
func TestExportIsFoundWithoutAName(t *testing.T) {
	g := &Graph{}
	g.Add(&Owner{Ref: Ref{File: "orders.js", Name: "router"},
		Decls: []Decl{{Method: "GET", Path: "/x"}}})

	if o := g.Find(Ref{File: "orders.js"}); o == nil {
		t.Fatal("the only router in a file is its export")
	}
	g.Add(&Owner{Ref: Ref{File: "orders.js", Name: "other"}})
	if o := g.Find(Ref{File: "orders.js"}); o != nil {
		t.Error("two routers and no marked export is ambiguous, so neither wins")
	}
}

func sigs(rs []routes.Route) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Signature()
	}
	return out
}

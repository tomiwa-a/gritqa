package routes

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/products", "/products"},
		{"products", "/products"},
		{"/products/", "/products"},
		{"/", "/"},

		// chi and Go 1.22 ServeMux braces become the dashboard's colon form.
		{"/products/{id}", "/products/:id"},
		{"/products/{id}/prices", "/products/:id/prices"},
		{"/users/{userID}/orders/{orderID}", "/users/:userID/orders/:orderID"},

		// gin, echo and fiber already use it.
		{"/products/:id", "/products/:id"},

		// chi regex constraints and wildcards.
		{"/products/{id:[0-9]+}", "/products/:id"},
		{"/files/{rest...}", "/files/*"},
		{"/static/*", "/static/*"},

		{"//products//search/", "/products/search"},
		{"", ""},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestJoin(t *testing.T) {
	cases := []struct{ prefix, pattern, want string }{
		{"", "/products", "/products"},
		{"/", "/products", "/products"},
		{"/products", "/", "/products"},
		{"/products", "", "/products"},
		{"/products", "/{id}", "/products/:id"},
		{"/api/v1", "/products", "/api/v1/products"},
		{"/api/v1/", "/products", "/api/v1/products"},
		{"/api", "products", "/api/products"},
		{"/products", "/{id}/archive", "/products/:id/archive"},
	}
	for _, c := range cases {
		if got := Join(c.prefix, c.pattern); got != c.want {
			t.Errorf("Join(%q, %q) = %q, want %q", c.prefix, c.pattern, got, c.want)
		}
	}
}

func TestSignature(t *testing.T) {
	if got := (Route{Method: "GET", Path: "/products"}).Signature(); got != "GET /products" {
		t.Errorf("got %q", got)
	}
	if got := (Route{Path: "/products"}).Signature(); got != "ANY /products" {
		t.Errorf("got %q", got)
	}
}

func TestMethod(t *testing.T) {
	cases := []struct {
		in    string
		want  string
		valid bool
	}{
		{"GET", "GET", true},
		{"get", "GET", true},
		{`"POST"`, "POST", true},
		{"PATCH", "PATCH", true},
		{"HEAD", "HEAD", false},
		{"OPTIONS", "OPTIONS", false},
		{"Any", "ANY", false},
	}
	for _, c := range cases {
		got, ok := Method(c.in)
		if got != c.want || ok != c.valid {
			t.Errorf("Method(%q) = (%q, %v), want (%q, %v)", c.in, got, ok, c.want, c.valid)
		}
	}
}

func TestSortIsStableAndPathFirst(t *testing.T) {
	rs := []Route{
		{Method: "POST", Path: "/products"},
		{Method: "GET", Path: "/products/:id"},
		{Method: "GET", Path: "/products"},
	}
	Sort(rs)

	want := []string{"GET /products", "POST /products", "GET /products/:id"}
	for i, w := range want {
		if got := rs[i].Signature(); got != w {
			t.Errorf("index %d: got %q, want %q", i, got, w)
		}
	}
}

func TestDedupe(t *testing.T) {
	rs := Dedupe([]Route{
		{Method: "GET", Path: "/products", File: "routes/products.go"},
		{Method: "GET", Path: "/products", File: "routes/products.go"},
		{Method: "GET", Path: "/products", File: "routes/admin.go"},
	})
	if len(rs) != 2 {
		t.Fatalf("got %d routes, want 2: %+v", len(rs), rs)
	}
}

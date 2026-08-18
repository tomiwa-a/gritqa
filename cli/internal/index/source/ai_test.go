package source

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/gritqa/cli/internal/index/routes"
)

type fake struct {
	mu    sync.Mutex
	calls []string
	give  map[string][]routes.Route
	fail  error
}

func (f *fake) Extract(_ context.Context, file File) ([]routes.Route, error) {
	f.mu.Lock()
	f.calls = append(f.calls, file.Path)
	f.mu.Unlock()
	if f.fail != nil {
		return nil, f.fail
	}
	return f.give[file.Path], nil
}

type memo map[string][]routes.Route

func (m memo) Extracted(hash string) ([]routes.Route, bool, error) {
	rs, ok := m[hash]
	return rs, ok, nil
}

func (m memo) SaveExtracted(hash string, rs []routes.Route) error {
	m[hash] = rs
	return nil
}

// The whole cost argument for this source rests on the cache: an unchanged file
// must never reach the model twice.
func TestExtractionIsCachedByHash(t *testing.T) {
	files := []File{
		{Path: "config/routes.rb", Language: "ruby", Hash: "a", Content: []byte("x")},
		{Path: "app/controllers/orders.rb", Language: "ruby", Hash: "b", Content: []byte("y")},
	}
	ex := &fake{give: map[string][]routes.Route{
		"config/routes.rb":          {{Method: "GET", Path: "/orders"}},
		"app/controllers/orders.rb": {{Method: "POST", Path: "orders/"}},
	}}
	cache := memo{}

	first, err := FromAI(context.Background(), ex, cache, files)
	if err != nil {
		t.Fatal(err)
	}
	want := "config/routes.rb GET /orders\napp/controllers/orders.rb POST /orders"
	if got := where(first.Routes); strings.Join(got, "\n") != want {
		t.Errorf("got %v", got)
	}
	if first.Uploaded != 2 || len(ex.calls) != 2 {
		t.Errorf("uploaded %d, called %v", first.Uploaded, ex.calls)
	}

	second, err := FromAI(context.Background(), ex, cache, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 2 {
		t.Errorf("second run called the model again: %v", ex.calls)
	}
	if second.Uploaded != 0 {
		t.Errorf("uploaded = %d, want 0", second.Uploaded)
	}
	if got := where(second.Routes); strings.Join(got, "\n") != want {
		t.Errorf("cached run differs: %v", got)
	}
}

// A model is the only source that can invent an endpoint, so what it returns is
// filtered rather than trusted.
func TestWhatTheModelReturnsIsFiltered(t *testing.T) {
	ex := &fake{give: map[string][]routes.Route{
		"api.rb": {
			{Method: "GET", Path: "/orders"},
			{Method: "get", Path: "orders"},   // same route, spelled differently
			{Method: "TRACE", Path: "/debug"}, // not a method the dashboard shows
			{Method: "GET", Path: "  "},       // names no path
			{Method: "", Path: "/legacy"},     // no verb is allowed: ANY
			{Method: "GET", Path: "/x", File: "/etc/passwd"},
		},
	}}

	res, err := FromAI(context.Background(), ex, nil, []File{{Path: "api.rb", Hash: "a", Content: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	want := "ANY /legacy\nGET /orders\nGET /x"
	if got := sigs(res.Routes); strings.Join(got, "\n") != want {
		t.Errorf("got %v, want %v", got, strings.Split(want, "\n"))
	}
	for _, r := range res.Routes {
		if r.File != "api.rb" {
			t.Errorf("file = %q, want the file that was sent", r.File)
		}
	}
}

// A bad token would otherwise upload the whole repo before failing.
func TestFirstFailureEndsThePass(t *testing.T) {
	ex := &fake{fail: errors.New("401 Unauthorized")}
	files := make([]File, 5)
	for i := range files {
		files[i] = File{Path: "a.rb", Hash: string(rune('a' + i)), Content: []byte("x")}
	}

	if _, err := FromAI(context.Background(), ex, memo{}, files); err == nil {
		t.Fatal("want an error")
	}
	if len(ex.calls) != 1 {
		t.Errorf("made %d calls, want 1", len(ex.calls))
	}
}

func TestCandidateSkipsFilesThatCannotDeclareARoute(t *testing.T) {
	cases := []struct {
		file string
		body string
		want bool
	}{
		{"config/routes.rb", "Rails.application.routes.draw do\nend\n", true},
		{"app/controllers/orders_controller.rb", "class OrdersController\nend\n", true},
		{"app/models/order.rb", "class Order < ApplicationRecord\n  has_many :items\nend\n", false},
		{"src/main/java/com/x/OrderApi.java", "@GetMapping(\"/orders\")\n", true},
		{"src/main/java/com/x/Order.java", "class Order { String getName() { return n; } }\n", false},
		{"lib/api.php", "Route::get('/orders', 'C@i');\n", true},
		{"src/lib.rs", "#[get(\"/orders\")]\nfn list() {}\n", true},
		{"src/math.rs", "pub fn add(a: i32) -> i32 { a }\n", false},
		{"db/schema.rb", "create_table :orders do |t|\nend\n", false},
	}

	for _, c := range cases {
		if got := Candidate(c.file, []byte(c.body)); got != c.want {
			t.Errorf("%s: candidate = %v, want %v", c.file, got, c.want)
		}
	}
	if Candidate("config/routes.rb", make([]byte, maxUpload+1)) {
		t.Error("a file too long to be worth reading is not a candidate")
	}
}

func where(rs []routes.Route) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.File + " " + r.Signature()
	}
	return out
}

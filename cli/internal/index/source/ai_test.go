package source

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/gritqa/cli/internal/index/routes"
)

type fake struct {
	mu     sync.Mutex
	calls  []string
	give   map[string][]routes.Route
	fail   error
	failOn map[string]error
}

func (f *fake) Extract(_ context.Context, file File) ([]routes.Route, error) {
	f.mu.Lock()
	f.calls = append(f.calls, file.Path)
	f.mu.Unlock()
	if err := f.failOn[file.Path]; err != nil {
		return nil, err
	}
	if f.fail != nil {
		return nil, f.fail
	}
	return f.give[file.Path], nil
}

// a cache that cannot be written, which the routes must survive.
type deaf struct{ memo }

func (deaf) SaveExtracted(string, string, []routes.Route) error {
	return errors.New("disk I/O error")
}

type memo map[string][]routes.Route

func (m memo) Extracted(hash string) ([]routes.Route, bool, error) {
	rs, ok := m[hash]
	return rs, ok, nil
}

func (m memo) SaveExtracted(hash, _ string, rs []routes.Route) error {
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

func five() []File {
	files := make([]File, 5)
	for i := range files {
		files[i] = File{Path: "a.rb", Hash: string(rune('a' + i)), Content: []byte("x")}
	}
	return files
}

// A refused key would otherwise upload the whole repo before failing.
func TestARefusedKeyEndsThePass(t *testing.T) {
	ex := &fake{fail: fmt.Errorf("api.example.com %w in GRITQA_API_KEY", ErrRefused)}

	if _, err := FromAI(context.Background(), ex, memo{}, five()); err == nil {
		t.Fatal("want an error")
	}
	if len(ex.calls) != 1 {
		t.Errorf("made %d calls, want 1", len(ex.calls))
	}
}

// Any other failure costs its own file and nothing more — the first file is
// whichever one sorts first, not a file worth stopping for.
func TestOneUnreadableFileDoesNotEndThePass(t *testing.T) {
	ex := &fake{fail: errors.New("context deadline exceeded")}

	if _, err := FromAI(context.Background(), ex, memo{}, five()); err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 5 {
		t.Errorf("made %d calls, want all 5 tried", len(ex.calls))
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
		// A hand-rolled PHP front controller: the routing is the query string.
		{"index.php", "$controller = $_GET['controller'];\n", true},
		{"README.md", "# The orders API\n\nGET /orders returns them all.\n", false},
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

// The gateway is whichever file names the others. Naming one is coincidence.
func TestGatewayIsTheFileThatRoutesToTheRest(t *testing.T) {
	files := []File{
		{Path: "controllers/RoomController.php", Content: []byte("class RoomController {}")},
		{Path: "index.php", Content: []byte(`switch ($_GET['controller']) {
			case 'room': require './controllers/RoomController.php';
			case 'guest': require './controllers/GuestController.php';
		}`)},
		{Path: "controllers/GuestController.php", Content: []byte("class GuestController {}")},
	}

	if got := Gateway(files); got != 1 {
		t.Errorf("gateway = %d, want index.php at 1", got)
	}
	if got := Gateway(files[:1]); got != -1 {
		t.Errorf("gateway = %d, want none", got)
	}
	// One file requiring one other is a helper, not a gateway.
	two := []File{
		{Path: "a.php", Content: []byte("require './b.php';")},
		{Path: "b.php", Content: []byte("class B {}")},
	}
	if got := Gateway(two); got != -1 {
		t.Errorf("gateway = %d, want none", got)
	}
}

// Editing the gateway must re-read every file it routes to, or they keep a URL
// that no longer works.
func TestTheCacheKeyCoversTheGateway(t *testing.T) {
	f := File{Path: "a.php", Hash: "h1"}
	if f.key() != "h1" {
		t.Errorf("key = %q, want the file hash alone", f.key())
	}

	with := f
	with.Context = []File{{Path: "index.php", Hash: "g1"}}
	moved := with
	moved.Context = []File{{Path: "index.php", Hash: "g2"}}

	if with.key() == f.key() || with.key() == moved.key() {
		t.Errorf("keys collide: %q %q %q", f.key(), with.key(), moved.key())
	}
}

// A controller's URL depends on the gateway sent with it, so both hashes key the
// extraction. Saving under the file hash alone re-read all 24 files every run.
func TestASecondPassOnGatewayFilesCostsNothing(t *testing.T) {
	gateway := File{Path: "index.php", Language: "php", Hash: "g", Content: []byte("$_GET[")}
	files := []File{
		gateway,
		{Path: "controllers/a.php", Language: "php", Hash: "a", Content: []byte("x"),
			Context: []File{gateway}},
		{Path: "controllers/b.php", Language: "php", Hash: "b", Content: []byte("y"),
			Context: []File{gateway}},
	}
	ex := &fake{give: map[string][]routes.Route{
		"controllers/a.php": {{Method: "GET", Path: "/index.php?controller=a"}},
	}}
	cache := memo{}

	if _, err := FromAI(context.Background(), ex, cache, files); err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 3 {
		t.Fatalf("first pass made %d calls, want 3", len(ex.calls))
	}

	res, err := FromAI(context.Background(), ex, cache, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 3 {
		t.Errorf("second pass made %d more calls, want none", len(ex.calls)-3)
	}
	if len(res.Routes) != 1 {
		t.Errorf("routes = %+v, want the cached one", res.Routes)
	}
}

// Editing the gateway changes every URL that routes through it, so every one of
// those files has to be read again.
func TestEditingTheGatewayReReadsWhatItRoutesTo(t *testing.T) {
	gateway := File{Path: "index.php", Hash: "g", Content: []byte("$_GET[")}
	controller := File{Path: "controllers/a.php", Hash: "a", Content: []byte("x"),
		Context: []File{gateway}}
	ex, cache := &fake{}, memo{}

	if _, err := FromAI(context.Background(), ex, cache, []File{gateway, controller}); err != nil {
		t.Fatal(err)
	}

	moved := gateway
	moved.Hash = "g2"
	controller.Context = []File{moved}
	if _, err := FromAI(context.Background(), ex, cache, []File{moved, controller}); err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 4 {
		t.Errorf("made %d calls, want the controller read again", len(ex.calls))
	}
}

// A file the model could not read has to be reported. Silently returning nothing
// for it is the one failure this project exists to avoid.
func TestAnUnreadFileIsCounted(t *testing.T) {
	files := five()
	files[3].Path = "unreadable.rb"
	ex := &fake{failOn: map[string]error{
		"unreadable.rb": errors.New("context deadline exceeded"),
	}}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 5 {
		t.Errorf("made %d calls, want all 5 tried", len(ex.calls))
	}
	if res.Unread != 1 || res.Uploaded != 4 {
		t.Errorf("uploaded %d, unread %d, want 4 and 1", res.Uploaded, res.Unread)
	}
}

// A lost cache write keeps its routes but costs a re-read, so it is said out loud.
func TestALostCacheWriteIsCounted(t *testing.T) {
	ex := &fake{give: map[string][]routes.Route{
		"a.rb": {{Method: "GET", Path: "/orders"}},
	}}

	res, err := FromAI(context.Background(), ex, deaf{memo{}}, five())
	if err != nil {
		t.Fatal(err)
	}
	if res.Uncached != 5 {
		t.Errorf("uncached = %d, want 5", res.Uncached)
	}
	if len(res.Routes) == 0 {
		t.Error("the routes were read, so they should still be here")
	}
}

// A key refused partway through must not send the rest of the repo after it.
func TestARefusalMidPassEndsThePass(t *testing.T) {
	files := five()
	files[1].Path = "refused.rb"
	ex := &fake{failOn: map[string]error{
		"refused.rb": fmt.Errorf("api.example.com %w in GRITQA_API_KEY", ErrRefused),
	}}

	if _, err := FromAI(context.Background(), ex, memo{}, files); err == nil {
		t.Fatal("want the refusal reported, not swallowed")
	}
}

// What the model already read stays available without a key. Reporting no
// endpoints for an unchanged repo would empty the coverage grid.
func TestCachedEndpointsSurviveWithoutAKey(t *testing.T) {
	file := File{Path: "controllers/a.php", Hash: "a", Content: []byte("$_GET[")}
	cache := memo{}
	if _, err := FromAI(context.Background(), &fake{give: map[string][]routes.Route{
		"controllers/a.php": {{Method: "GET", Path: "/index.php?controller=a"}},
	}}, cache, []File{file}); err != nil {
		t.Fatal(err)
	}

	res, err := FromAI(context.Background(), nil, cache, []File{file})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Routes) != 1 || res.Kind != AI {
		t.Fatalf("res = %+v, want the cached endpoint", res)
	}
	if res.Uploaded != 0 || res.Unread != 0 {
		t.Errorf("uploaded %d, unread %d — nothing was sent", res.Uploaded, res.Unread)
	}
}

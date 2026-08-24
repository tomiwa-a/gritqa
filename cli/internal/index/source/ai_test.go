package source

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/model"
)

type fake struct {
	mu     sync.Mutex
	calls  []string
	give   map[string][]routes.Route
	fail   error
	failOn map[string]error
	// flaky fails a file that many times and then answers, which is the shape of
	// the failure this source retries for.
	flaky map[string]int
	// turnAway answers a file with a quota that many times. Negative means always.
	turnAway map[string]int
}

func (f *fake) Extract(_ context.Context, file File) ([]routes.Route, error) {
	f.mu.Lock()
	f.calls = append(f.calls, file.Path)
	left := f.flaky[file.Path]
	if left > 0 {
		f.flaky[file.Path] = left - 1
	}
	quota := f.turnAway[file.Path]
	if quota > 0 {
		f.turnAway[file.Path] = quota - 1
	}
	f.mu.Unlock()
	if quota != 0 {
		return nil, model.Throttled(errors.New("the endpoint answered 429"), 0)
	}
	if left > 0 {
		return nil, errors.New("the reply was not the endpoint list it was asked for")
	}
	if err := f.failOn[file.Path]; err != nil {
		return nil, err
	}
	if f.fail != nil {
		return nil, f.fail
	}
	return f.give[file.Path], nil
}

// quick takes the wait out of the retry. The policy under test is which failures
// are tried again, not how long the pause between them is.
func quick(t *testing.T) {
	t.Helper()
	wasBackoff, wasQuota := backoff, quotaPause
	backoff, quotaPause = 0, 0
	t.Cleanup(func() { backoff, quotaPause = wasBackoff, wasQuota })
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
	quick(t)
	ex := &fake{fail: errors.New("context deadline exceeded")}

	if _, err := FromAI(context.Background(), ex, memo{}, five()); err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 5*attempts {
		t.Errorf("made %d calls, want all 5 tried %d times each", len(ex.calls), attempts)
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
func TestAnUnreadFileIsNamedWithItsReason(t *testing.T) {
	quick(t)
	files := five()
	files[3].Path = "unreadable.rb"
	ex := &fake{failOn: map[string]error{
		"unreadable.rb": errors.New("context deadline exceeded"),
	}}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 4+attempts {
		t.Errorf("made %d calls, want 4 read and 1 retried", len(ex.calls))
	}
	if res.Uploaded != 5 || len(res.Failed) != 1 {
		t.Fatalf("uploaded %d, failed %d, want 5 and 1", res.Uploaded, len(res.Failed))
	}
	got := res.Failed[0]
	if got.Path != "unreadable.rb" || got.Attempts != attempts ||
		!strings.Contains(got.Reason, "deadline") {
		t.Errorf("failure = %+v, want the file, the tries and the reason", got)
	}
}

// Seven of the measured failures were the connection being reset mid-call, which
// the same call makes it through on the next try. That, and the quota below, is
// the whole reason four identical runs reported four different endpoint counts.
func TestAFlakyFileIsReadOnTheSecondTry(t *testing.T) {
	quick(t)
	files := five()
	files[3].Path = "flaky.rb"
	ex := &fake{
		flaky: map[string]int{"flaky.rb": 1},
		give:  map[string][]routes.Route{"flaky.rb": {{Method: "GET", Path: "/orders"}}},
	}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Failed) != 0 {
		t.Fatalf("failed = %+v, want the retry to have read it", res.Failed)
	}
	if len(res.Routes) != 1 {
		t.Errorf("got %d endpoints, want the one the second try found", len(res.Routes))
	}
	if len(ex.calls) != 6 {
		t.Errorf("made %d calls, want one extra for the retry", len(ex.calls))
	}
}

// A request the endpoint rejected answers the same way however often it is
// asked, so spending two more calls on it is only a bill.
func TestARejectedRequestIsNotRetried(t *testing.T) {
	quick(t)
	files := five()
	files[3].Path = "toobig.rb"
	ex := &fake{failOn: map[string]error{
		"toobig.rb": fmt.Errorf("api.example.com answered 413: %w", model.ErrHopeless),
	}}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(ex.calls) != 5 {
		t.Errorf("made %d calls, want the rejection taken at its word", len(ex.calls))
	}
	if len(res.Failed) != 1 || res.Failed[0].Attempts != 1 {
		t.Errorf("failed = %+v, want one file tried once", res.Failed)
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
	if res.Uploaded != 0 || len(res.Failed) != 0 {
		t.Errorf("uploaded %d, failed %d — nothing was sent", res.Uploaded, len(res.Failed))
	}
}

// A quota is the endpoint declining to read the file, not a reading that failed,
// so being turned away three times and then read is a success on the first
// attempt. Measured the other way round: 15 files spent all three attempts on
// 429s and reported no endpoints, for a project whose files were fine.
func TestAQuotaAnswerIsNotAnAttempt(t *testing.T) {
	quick(t)
	files := five()
	files[2].Path = "busy.rb"
	ex := &fake{
		turnAway: map[string]int{"busy.rb": 3},
		give:     map[string][]routes.Route{"busy.rb": {{Method: "GET", Path: "/loans"}}},
	}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Failed) != 0 {
		t.Fatalf("failed = %+v, want the pause to have cleared it", res.Failed)
	}
	if got := calls(ex, "busy.rb"); got != 4 {
		t.Fatalf("called busy.rb %d times, want 3 refusals and one read", got)
	}
	if len(res.Routes) != 1 {
		t.Fatalf("got %d endpoints, want the one the fourth call returned", len(res.Routes))
	}
}

// Waiting out a quota has to be bounded, or an exhausted one parks the pass. The
// file is reported with its reason instead, which is what says whether to slow
// down or wait for the window.
func TestAQuotaThatNeverClearsIsReported(t *testing.T) {
	quick(t)
	files := five()
	files[2].Path = "busy.rb"
	ex := &fake{turnAway: map[string]int{"busy.rb": -1}}

	res, err := FromAI(context.Background(), ex, memo{}, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Failed) != 1 || res.Failed[0].Path != "busy.rb" {
		t.Fatalf("failed = %+v, want busy.rb named", res.Failed)
	}
	if !strings.Contains(res.Failed[0].Reason, "429") {
		t.Fatalf("reason = %q, want the quota named", res.Failed[0].Reason)
	}
	if got, want := calls(ex, "busy.rb"), declines+attempts; got != want {
		t.Fatalf("called busy.rb %d times, want %d", got, want)
	}
}

// The pause is one thing every worker respects, and it grows when it is not
// enough. Being turned away during a pause is the endpoint saying so.
func TestThePauseIsSharedAndGrows(t *testing.T) {
	was := quotaPause
	quotaPause = 30 * time.Millisecond
	t.Cleanup(func() { quotaPause = was })

	var g gate
	g.hold(0)

	started := time.Now()
	if err := g.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if waited := time.Since(started); waited < quotaPause {
		t.Fatalf("waited %v, want at least %v", waited, quotaPause)
	}

	g.hold(0)
	g.hold(0) // turned away while already holding
	g.mu.Lock()
	left := time.Until(g.until)
	g.mu.Unlock()
	if left <= quotaPause {
		t.Fatalf("still holding for %v, want longer than one pause", left)
	}
}

func calls(ex *fake, path string) int {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	n := 0
	for _, p := range ex.calls {
		if p == path {
			n++
		}
	}
	return n
}

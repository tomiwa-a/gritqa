package source

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/model"
)

// ErrRefused is a key the endpoint would not accept — the model's own or the
// server's. It ends a pass, where any other failure only skips its file.
var ErrRefused = model.ErrRefused

// Extractor reads one file's endpoints, with the user's own key or the server's.
type Extractor interface {
	Extract(ctx context.Context, f File) ([]routes.Route, error)
}

// Cache keys an extraction on the file's hash: one call per file version.
type Cache interface {
	Extracted(hash string) ([]routes.Route, bool, error)
	SaveExtracted(hash, fileHash string, rs []routes.Route) error
}

type File struct {
	Path     string
	Language string
	Hash     string
	Content  []byte
	// Context is sent with the file but never extracted from: the gateway that
	// routes to it. A controller alone does not know the URL it answers on.
	Context []File
}

// key identifies this extraction. Context is part of it, or editing the gateway
// would leave every file it routes to holding a stale URL.
func (f File) key() string {
	if len(f.Context) == 0 {
		return f.Hash
	}
	sum := sha256.New()
	sum.Write([]byte(f.Hash))
	for _, c := range f.Context {
		sum.Write([]byte(c.Hash))
	}
	return hex.EncodeToString(sum.Sum(nil))
}

// Gateway finds the file that routes to the others — a PHP front controller, a
// JS route table — and returns its index, or -1. It is the file that names the
// most of its siblings, and naming one is coincidence, so two is the floor.
func Gateway(files []File) int {
	best, most := -1, 1
	for i, f := range files {
		src := string(f.Content)
		n := 0
		for j, other := range files {
			if i == j {
				continue
			}
			if strings.Contains(src, path.Base(other.Path)) {
				n++
			}
		}
		if n > most {
			best, most = i, n
		}
	}
	return best
}

// FromAI is the last rung of the ladder, and the only one that sends source off
// the machine. A file the model cannot read is skipped.
func FromAI(ctx context.Context, ex Extractor, cache Cache, files []File) (Result, error) {
	if len(files) == 0 {
		return Result{}, nil
	}

	found := make([][]routes.Route, len(files))
	todo := make([]int, 0, len(files))

	for i, f := range files {
		if cache != nil {
			rs, ok, err := cache.Extracted(f.key())
			if err != nil {
				return Result{}, err
			}
			if ok {
				found[i] = stamp(rs, f.Path)
				continue
			}
		}
		todo = append(todo, i)
	}

	// Without a key the model is out of reach, but what it already read is not:
	// an unchanged repo keeps its endpoints instead of reporting none.
	var sent, uncached int
	var failed []Failure
	if ex != nil {
		var err error
		sent, failed, uncached, err = run(ctx, ex, cache, files, todo, found)
		if err != nil {
			return Result{}, err
		}
	}

	var out []routes.Route
	for _, rs := range found {
		out = append(out, rs...)
	}
	if len(out) == 0 {
		return Result{Uploaded: sent, Failed: failed, Uncached: uncached}, nil
	}
	return Result{Kind: AI, Routes: out, Uploaded: sent, Failed: failed, Uncached: uncached}, nil
}

// attempts is per file: a reply that failed once is worth asking for again, and
// the pause between them is what makes the second call different from the first.
const attempts = 3

// declines bounds how often one file may be turned away by a quota. A decline is
// not an attempt — the endpoint did not read the file — so it must be bounded
// separately or a exhausted quota parks the pass indefinitely.
const declines = 3

var backoff = 1500 * time.Millisecond

// quotaPause is what a quota costs when the endpoint names no delay of its own.
// It is deliberately long: the quota measured here is per minute, and guessing
// low cost 15 files their endpoints across three retries each.
var quotaPause = 15 * time.Second

// gate is the pass-wide pause, and it is the correction the measurement forced.
// A quota belongs to the deployment, not to one file, so four workers each
// backing off privately wake together and spend it again — measured as 15 files
// reporting nothing but 429 after three private retries apiece. One pause every
// worker respects is the only thing that clears a quota.
type gate struct {
	mu    sync.Mutex
	until time.Time
	held  int
}

// hold pauses every worker, doubling when it is asked again while already
// holding: being turned away during a pause is the endpoint saying the pause was
// too short.
func (g *gate) hold(d time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if d <= 0 {
		d = quotaPause
	}
	if time.Now().Before(g.until) {
		g.held++
		d <<= min(g.held, 3)
	}
	if until := time.Now().Add(d); until.After(g.until) {
		g.until = until
	}
}

func (g *gate) wait(ctx context.Context) error {
	g.mu.Lock()
	left := time.Until(g.until)
	g.mu.Unlock()

	if left <= 0 {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(left):
		return nil
	}
}

// read extracts one file, trying again when the failure is the kind another call
// can fix, and reports how many calls that took.
func read(ctx context.Context, ex Extractor, f File, g *gate) ([]routes.Route, int, error) {
	tries, turned := 0, 0
	for {
		if err := g.wait(ctx); err != nil {
			return nil, tries, err
		}
		tries++

		rs, err := ex.Extract(ctx, f)
		if err == nil {
			return rs, tries, nil
		}

		// A quota answer is the endpoint declining to read the file rather than a
		// reading that failed, so it does not spend one of the file's attempts. It
		// pauses every worker instead, which is what a shared quota responds to.
		var quota *model.Throttle
		if errors.As(err, &quota) && turned < declines && again(ctx, err) {
			turned++
			tries--
			g.hold(quota.Wait)
			continue
		}
		if tries == attempts || !again(ctx, err) {
			return nil, tries, err
		}
		select {
		case <-ctx.Done():
			return nil, tries, ctx.Err()
		case <-time.After(time.Duration(tries) * backoff):
		}
	}
}

// again separates the moment being wrong from the request being wrong. A refused
// key ends the pass, a 4xx answers the same way however often it is asked, and a
// cancelled run is not a failure to retry.
func again(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return false
	}
	return !errors.Is(err, ErrRefused) &&
		!errors.Is(err, model.ErrHopeless) &&
		!errors.Is(err, context.Canceled) &&
		!errors.Is(err, context.DeadlineExceeded)
}

// run returns how many files went to the model, which of them it could not read,
// and how many were read but could not be cached.
func run(ctx context.Context, ex Extractor, cache Cache, files []File, todo []int,
	found [][]routes.Route) (int, []Failure, int, error) {

	if len(todo) == 0 {
		return 0, nil, 0, nil
	}

	// The first call goes alone, so a refused key fails before the repo uploads.
	// Anything else — a timeout, a reply that will not parse — costs one file, the
	// same as it does in the workers below.
	first := files[todo[0]]
	sent, uncached := 1, 0
	var failed []Failure
	var pause gate
	rs, tries, err := read(ctx, ex, first, &pause)
	switch {
	case errors.Is(err, ErrRefused):
		return 0, nil, 0, fmt.Errorf("could not read %s with the model: %w", first.Path, err)
	case err != nil:
		failed = append(failed, Failure{Path: first.Path, Attempts: tries, Reason: err.Error()})
	default:
		found[todo[0]] = keep(rs, first.Path)
		if err := save(cache, first, found[todo[0]]); err != nil {
			uncached++
		}
	}

	var mu sync.Mutex
	var refused error
	jobs := make(chan int)
	var wg sync.WaitGroup

	for range min(runtime.GOMAXPROCS(0), 4) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				mu.Lock()
				stop := refused != nil
				mu.Unlock()
				if stop {
					continue
				}

				f := files[i]
				rs, tries, err := read(ctx, ex, f, &pause)
				mu.Lock()
				sent++
				if err != nil {
					failed = append(failed, Failure{
						Path: f.Path, Attempts: tries, Reason: err.Error(),
					})
					if errors.Is(err, ErrRefused) && refused == nil {
						refused = fmt.Errorf("could not read %s with the model: %w", f.Path, err)
					}
					mu.Unlock()
					continue
				}
				mu.Unlock()

				found[i] = keep(rs, f.Path)
				mu.Lock()
				if err := save(cache, f, found[i]); err != nil {
					uncached++
				}
				mu.Unlock()
			}
		}()
	}

	for _, i := range todo[1:] {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return sent, failed, uncached, ctx.Err()
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()
	if refused != nil {
		return sent, failed, uncached, refused
	}
	sortFailures(failed)
	return sent, failed, uncached, nil
}

// sortFailures makes the report stable: four workers finishing in whatever order
// they finish is not something the reader should have to see.
func sortFailures(failed []Failure) {
	sort.Slice(failed, func(i, j int) bool { return failed[i].Path < failed[j].Path })
}

// save reports its failure rather than hiding it: the routes are still good, but
// the file will be read again next run, which is what the cache exists to avoid.
func save(cache Cache, f File, rs []routes.Route) error {
	if cache == nil {
		return nil
	}
	return cache.SaveExtracted(f.key(), f.Hash, rs)
}

// keep filters what the model returned. It is the one source that can invent an
// endpoint, and an invented endpoint gets tests drafted against it.
func keep(rs []routes.Route, file string) []routes.Route {
	out := make([]routes.Route, 0, len(rs))
	for _, r := range rs {
		if strings.TrimSpace(r.Path) == "" {
			continue
		}
		method := ""
		if r.Method != "" {
			m, ok := routes.Method(r.Method)
			if !ok {
				continue
			}
			method = m
		}
		out = append(out, routes.Route{
			Method: method, Path: routes.Normalize(r.Path), File: file,
			Line: r.Line, Handler: r.Handler, Middleware: r.Middleware,
		})
	}
	routes.Sort(out)
	return routes.Dedupe(out)
}

func stamp(rs []routes.Route, file string) []routes.Route {
	out := make([]routes.Route, len(rs))
	for i, r := range rs {
		r.File = file
		out[i] = r
	}
	return out
}

// Candidate reports whether a file is worth a model call: sending a whole Rails
// repo to find one routes.rb would cost hundreds. A file qualifies on where it
// sits or on a routing construct in its text, broadly — a false positive costs
// one call, a false negative loses an endpoint.
func Candidate(file string, body []byte) bool {
	if len(body) == 0 || len(body) > maxUpload {
		return false
	}
	if routingPath(file) {
		return true
	}
	src := string(body)
	for _, m := range markers {
		if strings.Contains(src, m) {
			return true
		}
	}
	return false
}

const maxUpload = 128 << 10

func routingPath(file string) bool {
	lower := strings.ToLower(file)
	base := strings.TrimSuffix(path.Base(lower), path.Ext(lower))

	for _, w := range []string{
		"route", "router", "controller", "handler", "endpoint", "url", "api", "web",
	} {
		if base == w || strings.HasSuffix(base, "_"+w) || strings.HasSuffix(base, w+"s") ||
			strings.Contains(lower, "/"+w+"/") || strings.Contains(lower, "/"+w+"s/") {
			return true
		}
	}
	return false
}

// markers are how a route declares itself in the languages GritQA cannot read.
var markers = []string{
	"Mapping(", "@Path(", "@GET", "@POST", "@PUT", "@PATCH", "@DELETE",
	"HttpGet", "HttpPost", "HttpPut", "HttpPatch", "HttpDelete",
	"Route(", "Route::", ".route(", "MapGet(", "MapPost(", "MapPut(", "MapDelete(",
	"resources :", "resource :", "namespace :", "scope ",
	"#[get", "#[post", "#[put", "#[patch", "#[delete",
	"get '", "get \"", "post '", "post \"", "put '", "put \"",
	"patch '", "patch \"", "delete '", "delete \"",
	// A hand-rolled PHP front controller routes on the query string, and the file
	// that defines that convention is usually called index.php.
	"$_GET[", "$_POST[", "$_SERVER[",
}

// Client is the CLI's half of /api/cli/extract.
type Client struct {
	Server  string
	Token   string
	Project string
	HTTP    *http.Client
}

type extractRequest struct {
	Project  string        `json:"project"`
	Path     string        `json:"path"`
	Language string        `json:"language"`
	Content  string        `json:"content"`
	Context  []contextFile `json:"context,omitempty"`
}

type contextFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type extractResponse struct {
	Endpoints []routes.Route `json:"endpoints"`
}

func (c *Client) Extract(ctx context.Context, f File) ([]routes.Route, error) {
	var with []contextFile
	for _, cf := range f.Context {
		with = append(with, contextFile{Path: cf.Path, Content: string(cf.Content)})
	}
	body, err := json.Marshal(extractRequest{
		Project: c.Project, Path: f.Path, Language: f.Language,
		Content: string(f.Content), Context: with,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.Server, "/")+"/api/cli/extract", strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Token)

	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, fmt.Errorf("%s %w", c.Server, ErrRefused)
	// The server relaying a provider's quota is the same condition as hitting one
	// directly, so it reaches the same gate. No delay is named: a relayed 429
	// rarely carries the upstream's Retry-After, and quotaPause is the floor.
	case http.StatusTooManyRequests:
		return nil, model.Throttled(fmt.Errorf("%s said %s", c.Server, res.Status), 0)
	default:
		return nil, fmt.Errorf("%s said %s", c.Server, res.Status)
	}

	var out extractResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Endpoints, nil
}

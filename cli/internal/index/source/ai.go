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
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/index/routes"
	"github.com/gritqa/cli/internal/model"
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
	var sent, unread, uncached int
	if ex != nil {
		var err error
		sent, unread, uncached, err = run(ctx, ex, cache, files, todo, found)
		if err != nil {
			return Result{}, err
		}
	}

	var out []routes.Route
	for _, rs := range found {
		out = append(out, rs...)
	}
	if len(out) == 0 {
		return Result{Uploaded: sent, Unread: unread, Uncached: uncached}, nil
	}
	return Result{Kind: AI, Routes: out, Uploaded: sent, Unread: unread, Uncached: uncached}, nil
}

// run returns how many files were read, how many the model could not, and how
// many were read but could not be cached.
func run(ctx context.Context, ex Extractor, cache Cache, files []File, todo []int,
	found [][]routes.Route) (int, int, int, error) {

	if len(todo) == 0 {
		return 0, 0, 0, nil
	}

	// The first call goes alone, so a refused key fails before the repo uploads.
	// Anything else — a timeout, a reply that will not parse — costs one file, the
	// same as it does in the workers below.
	first := files[todo[0]]
	sent, unread, uncached := 1, 0, 0
	rs, err := ex.Extract(ctx, first)
	switch {
	case errors.Is(err, ErrRefused):
		return 0, 0, 0, fmt.Errorf("could not read %s with the model: %w", first.Path, err)
	case err != nil:
		sent, unread = 0, 1
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
				rs, err := ex.Extract(ctx, f)
				if err != nil {
					mu.Lock()
					unread++
					if errors.Is(err, ErrRefused) && refused == nil {
						refused = fmt.Errorf("could not read %s with the model: %w", f.Path, err)
					}
					mu.Unlock()
					continue
				}

				found[i] = keep(rs, f.Path)
				mu.Lock()
				if err := save(cache, f, found[i]); err != nil {
					uncached++
				}
				sent++
				mu.Unlock()
			}
		}()
	}

	for _, i := range todo[1:] {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return sent, unread, uncached, ctx.Err()
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()
	if refused != nil {
		return sent, unread, uncached, refused
	}
	return sent, unread, uncached, nil
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
	default:
		return nil, fmt.Errorf("%s said %s", c.Server, res.Status)
	}

	var out extractResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Endpoints, nil
}

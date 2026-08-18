package source

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"runtime"
	"strings"
	"sync"

	"github.com/gritqa/cli/internal/index/routes"
)

// Extractor reads one file's endpoints. The server holds the model key.
type Extractor interface {
	Extract(ctx context.Context, f File) ([]routes.Route, error)
}

// Cache keys an extraction on the file's hash: one call per file version.
type Cache interface {
	Extracted(hash string) ([]routes.Route, bool, error)
	SaveExtracted(hash string, rs []routes.Route) error
}

type File struct {
	Path     string
	Language string
	Hash     string
	Content  []byte
}

// FromAI is the last rung of the ladder, and the only one that sends source off
// the machine. A file the server cannot read is skipped.
func FromAI(ctx context.Context, ex Extractor, cache Cache, files []File) (Result, error) {
	if ex == nil || len(files) == 0 {
		return Result{}, nil
	}

	found := make([][]routes.Route, len(files))
	todo := make([]int, 0, len(files))

	for i, f := range files {
		if cache != nil {
			rs, ok, err := cache.Extracted(f.Hash)
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

	sent, err := run(ctx, ex, cache, files, todo, found)
	if err != nil {
		return Result{}, err
	}

	var out []routes.Route
	for _, rs := range found {
		out = append(out, rs...)
	}
	if len(out) == 0 {
		return Result{Uploaded: sent}, nil
	}
	return Result{Kind: AI, Routes: out, Uploaded: sent}, nil
}

func run(ctx context.Context, ex Extractor, cache Cache, files []File, todo []int,
	found [][]routes.Route) (int, error) {

	if len(todo) == 0 {
		return 0, nil
	}

	// The first call goes alone, so a bad token fails before the repo uploads.
	first := files[todo[0]]
	rs, err := ex.Extract(ctx, first)
	if err != nil {
		return 0, fmt.Errorf("could not read %s with the model: %w", first.Path, err)
	}
	found[todo[0]] = keep(rs, first.Path)
	save(cache, first.Hash, found[todo[0]])

	var mu sync.Mutex
	sent := 1
	jobs := make(chan int)
	var wg sync.WaitGroup

	for range min(runtime.GOMAXPROCS(0), 4) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				f := files[i]
				rs, err := ex.Extract(ctx, f)
				if err != nil {
					continue
				}
				found[i] = keep(rs, f.Path)
				mu.Lock()
				save(cache, f.Hash, found[i])
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
			return sent, ctx.Err()
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()
	return sent, nil
}

func save(cache Cache, hash string, rs []routes.Route) {
	if cache != nil {
		_ = cache.SaveExtracted(hash, rs)
	}
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
}

// Client is the CLI's half of /api/cli/extract.
type Client struct {
	Server  string
	Token   string
	Project string
	HTTP    *http.Client
}

type extractRequest struct {
	Project  string `json:"project"`
	Path     string `json:"path"`
	Language string `json:"language"`
	Content  string `json:"content"`
}

type extractResponse struct {
	Endpoints []routes.Route `json:"endpoints"`
}

func (c *Client) Extract(ctx context.Context, f File) ([]routes.Route, error) {
	body, err := json.Marshal(extractRequest{
		Project: c.Project, Path: f.Path, Language: f.Language, Content: string(f.Content),
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

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s said %s", c.Server, res.Status)
	}

	var out extractResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Endpoints, nil
}

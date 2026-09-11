package run

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

type Response struct {
	Status  int
	Headers http.Header
	Body    []byte
	JSON    any
	Elapsed time.Duration
}

type StepStatus string

const (
	StepPending StepStatus = "pending"
	StepPassed  StepStatus = "passed"
	StepFailed  StepStatus = "failed"
	StepSkipped StepStatus = "skipped"
	StepError   StepStatus = "error"
)

// StepResult is what one step did. Body is kept because M3's repair pass needs
// the response the assertion actually saw.
type StepResult struct {
	ID string
	// Kind is what this step was. The engine always resolves it, so a reporter
	// reads it rather than repeating the default -- and IsHTTP is there for the
	// zero value a result built by hand still has.
	Kind     plan.StepKind
	Name     string
	Method   string
	URL      string
	Status   StepStatus
	Code     int
	Elapsed  time.Duration
	Attempts int
	Checks   []Check
	Body     []byte
	Err      string
	// Moved is what this step changed in the world, when a State was watching.
	// Empty is a finding in its own right for a step that claimed to write.
	Moved []Moved
	// SQL-only.
	RowsAffected int64
	// Shell-only.
	Stdout   string
	ExitCode int
}

// step runs one step, dispatching by kind.
func (e *Engine) step(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
	kind := kindOf(s)
	var r StepResult
	switch kind {
	case plan.SQLStep:
		r = e.sqlStep(ctx, s, vars)
	case plan.ShellStep:
		r = e.shellStep(ctx, s, vars)
	default:
		r = e.httpStep(ctx, s, vars)
	}
	r.Kind = kind
	return e.hide(r)
}

// hide masks what a result carries out of this process. A step's report reaches
// the dashboard, local history and a repair prompt, and a configured credential
// reaches all three the moment it is interpolated -- into a URL, a statement, an
// asserted value, or a response that echoes back what was sent. Done at the one
// point every kind converges, so a kind added later cannot forget.
func (e *Engine) hide(r StepResult) StepResult {
	if len(e.Secrets) == 0 {
		return r
	}
	r.URL, r.Err, r.Stdout = e.mask(r.URL), e.mask(r.Err), e.mask(r.Stdout)
	if len(r.Body) > 0 {
		r.Body = []byte(e.mask(string(r.Body)))
	}
	for i, c := range r.Checks {
		r.Checks[i].Expected, r.Checks[i].Actual = e.mask(c.Expected), e.mask(c.Actual)
	}
	return r
}

// IsHTTP is the question every reporter asks: does this step have a method, a
// route and a status, or does it have rows or an exit code instead.
func (s StepResult) IsHTTP() bool {
	return s.Kind == plan.HTTPStep || s.Kind == ""
}

// kindOf resolves the absent kind a plan written before there was more than one
// carries. It is done in one place so nothing downstream repeats the default.
func kindOf(s plan.Step) plan.StepKind {
	if s.Kind == "" {
		return plan.HTTPStep
	}
	return s.Kind
}

// httpStep runs one HTTP step: interpolate once, then send until it passes or
// the retry budget runs out. Assertions are evaluated before extraction, so a
// 401 reports the status it got rather than a missing field nobody asked about.
func (e *Engine) httpStep(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
	out := StepResult{ID: s.ID, Name: s.Label(), Method: s.Request.Method, URL: s.Request.URL}

	req, err := e.build(s, vars)
	if err != nil {
		out.Status, out.Err = StepError, err.Error()
		return out
	}
	out.URL = e.mask(req.url)

	attempts, delay := s.Attempts()
	for i := 1; i <= attempts; i++ {
		if i > 1 && delay > 0 {
			select {
			case <-ctx.Done():
				out.Status, out.Err = StepError, ctx.Err().Error()
				return out
			case <-time.After(time.Duration(delay) * time.Millisecond):
			}
		}
		out.Attempts = i

		res, err := e.send(ctx, req)
		if err != nil {
			out.Status, out.Err = StepError, err.Error()
			out.Code, out.Elapsed, out.Body, out.Checks = 0, 0, nil, nil
			continue
		}
		out.Code, out.Elapsed, out.Body, out.Err = res.Status, res.Elapsed, res.Body, ""

		checks, err := Assert(s.Assertions, res, vars)
		out.Checks = checks
		if err != nil {
			out.Status, out.Err = StepError, err.Error()
			continue
		}
		if !allPassed(checks) {
			out.Status = StepFailed
			continue
		}
		if err := Extract(s.Extract, res, vars); err != nil {
			out.Status, out.Err = StepError, err.Error()
			return out
		}
		out.Status = StepPassed
		return out
	}
	return out
}

type request struct {
	method  string
	url     string
	headers map[string]string
	body    []byte
}

func (e *Engine) build(s plan.Step, vars map[string]string) (request, error) {
	path, err := Text(s.Request.URL, vars)
	if err != nil {
		return request{}, err
	}
	headers, err := Strings(s.Request.Headers, vars)
	if err != nil {
		return request{}, err
	}
	query, err := Strings(s.Request.Query, vars)
	if err != nil {
		return request{}, err
	}
	body, err := Body(s.Request.Body, vars)
	if err != nil {
		return request{}, err
	}

	out := request{method: s.Request.Method, url: withQuery(join(e.BaseURL, path), query), headers: headers}
	if body != nil {
		if out.body, err = json.Marshal(body); err != nil {
			return request{}, err
		}
	}
	return out, nil
}

func (e *Engine) send(ctx context.Context, r request) (*Response, error) {
	var body io.Reader
	if len(r.body) > 0 {
		body = bytes.NewReader(r.body)
	}

	req, err := http.NewRequestWithContext(ctx, r.method, r.url, body)
	if err != nil {
		return nil, err
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	if len(r.body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	started := time.Now()
	res, err := e.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", r.method, r.url, unwrapURL(err))
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", r.method, r.url, err)
	}

	out := &Response{
		Status:  res.StatusCode,
		Headers: res.Header,
		Body:    raw,
		Elapsed: time.Since(started),
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out.JSON)
	}
	return out, nil
}

func join(base, path string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if base == "" {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return strings.TrimRight(base, "/") + path
}

func withQuery(u string, query map[string]string) string {
	if len(query) == 0 {
		return u
	}
	values := url.Values{}
	for k, v := range query {
		values.Set(k, v)
	}
	sep := "?"
	if strings.Contains(u, "?") {
		sep = "&"
	}
	return u + sep + values.Encode()
}

// unwrapURL drops net/http's "Get \"http://…\":" wrapper, which would repeat
// the method and URL the caller has already put in front of it.
func unwrapURL(err error) error {
	var e *url.Error
	if errors.As(err, &e) {
		return e.Err
	}
	return err
}

// mask keeps a configured secret out of the URL a step reports. Longest first, so
// a value that contains another is replaced whole.
// mask hides every configured secret in a piece of text. Longest first, so a
// value that contains another is not half-replaced.
func (e *Engine) mask(text string) string {
	if len(e.Secrets) == 0 {
		return text
	}
	if e.masks == nil {
		e.masks = append([]string(nil), e.Secrets...)
		sort.Slice(e.masks, func(i, j int) bool { return len(e.masks[i]) > len(e.masks[j]) })
	}
	for _, s := range e.masks {
		text = strings.ReplaceAll(text, s, hidden)
	}
	return text
}

const hidden = "•••"

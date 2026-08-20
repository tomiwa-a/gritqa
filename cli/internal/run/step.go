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

	"github.com/gritqa/cli/internal/plan"
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
	ID       string
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
}

// step runs one step: interpolate once, then send until it passes or the retry
// budget runs out. Assertions are evaluated before extraction, so a 401 reports
// the status it got rather than a missing field nobody asked about.
func (e *Engine) step(ctx context.Context, s plan.Step, vars map[string]string) StepResult {
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
func (e *Engine) mask(url string) string {
	if len(e.Secrets) == 0 {
		return url
	}
	if e.masks == nil {
		e.masks = append([]string(nil), e.Secrets...)
		sort.Slice(e.masks, func(i, j int) bool { return len(e.masks[i]) > len(e.masks[j]) })
	}
	for _, s := range e.masks {
		url = strings.ReplaceAll(url, s, hidden)
	}
	return url
}

const hidden = "•••"

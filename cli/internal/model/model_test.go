package model

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// api is an OpenAI-compatible endpoint that answers from a script, so every
// wire-level decision is checked without a model.
type api struct {
	mu   sync.Mutex
	got  []chatRequest
	auth []string
}

func fakeAPI(t *testing.T, path string, script ...func(w http.ResponseWriter)) (*Client, *api) {
	t.Helper()
	rec := &api{}
	n := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path+"/chat/completions" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var in chatRequest
		json.NewDecoder(r.Body).Decode(&in)

		rec.mu.Lock()
		rec.got = append(rec.got, in)
		rec.auth = append(rec.auth, r.Header.Get("Authorization"))
		i := n
		n++
		rec.mu.Unlock()

		if i >= len(script) {
			t.Errorf("call %d was not expected", i+1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		script[i](w)
	}))
	t.Cleanup(srv.Close)

	return &Client{Endpoint: srv.URL + path, Model: "gpt-4.1", Auth: Static("sk-test"), HTTP: srv.Client()}, rec
}

func (a *api) calls() []chatRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]chatRequest(nil), a.got...)
}

func says(content string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		json.NewEncoder(w).Encode(chatResponse{Choices: []struct {
			Message Message `json:"message"`
		}{{Message: Message{Role: "assistant", Content: content}}}})
	}
}

func fails(code int, body string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.WriteHeader(code)
		w.Write([]byte(body))
	}
}

func hello() []Message { return []Message{{Role: "user", Content: "hello"}} }

func TestCompleteAsksInTheOpenAIShape(t *testing.T) {
	c, rec := fakeAPI(t, "/v1", says("hi"))

	out, err := c.Complete(context.Background(), hello())
	if err != nil {
		t.Fatal(err)
	}
	if out != "hi" {
		t.Errorf("content = %q", out)
	}

	calls := rec.calls()
	if len(calls) != 1 {
		t.Fatalf("%d calls, want 1", len(calls))
	}
	if calls[0].Model != "gpt-4.1" {
		t.Errorf("model = %q", calls[0].Model)
	}
	if calls[0].ResponseFormat == nil || calls[0].ResponseFormat.Type != "json_object" {
		t.Errorf("response_format = %+v", calls[0].ResponseFormat)
	}
	if rec.auth[0] != "Bearer sk-test" {
		t.Errorf("Authorization = %q", rec.auth[0])
	}
}

// An endpoint that does not implement response_format still gets used.
func TestCompleteFallsBackWhenJSONModeIsRejected(t *testing.T) {
	c, rec := fakeAPI(t, "",
		fails(400, `{"error":{"message":"response_format is not supported"}}`),
		says("hi"))

	if _, err := c.Complete(context.Background(), hello()); err != nil {
		t.Fatal(err)
	}

	calls := rec.calls()
	if len(calls) != 2 {
		t.Fatalf("%d calls, want 2", len(calls))
	}
	if calls[0].ResponseFormat == nil || calls[1].ResponseFormat != nil {
		t.Error("the retry should drop response_format, not add it")
	}
}

func TestCompleteRetriesARateLimit(t *testing.T) {
	was := retryDelay
	retryDelay = time.Millisecond
	defer func() { retryDelay = was }()

	c, rec := fakeAPI(t, "", fails(429, `{"error":{"message":"slow down"}}`), says("hi"))

	if _, err := c.Complete(context.Background(), hello()); err != nil {
		t.Fatal(err)
	}
	if n := len(rec.calls()); n != 2 {
		t.Fatalf("%d calls, want 2", n)
	}
}

// The likely mistake: an sk-ant- key against api.anthropic.com, which speaks
// /v1/messages and 404s the only call GritQA makes.
func TestCompleteExplainsANonOpenAIEndpoint(t *testing.T) {
	c, _ := fakeAPI(t, "/v1/messages")
	c.Endpoint = strings.TrimSuffix(c.Endpoint, "/messages")

	_, err := c.Complete(context.Background(), hello())
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"chat completions", "proxy"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

func TestCompleteExplainsARefusedKey(t *testing.T) {
	c, _ := fakeAPI(t, "", fails(401, `{"error":{"message":"invalid api key"}}`))

	_, err := c.Complete(context.Background(), hello())
	if err == nil || !strings.Contains(err.Error(), KeyEnv) {
		t.Fatalf("err = %v, want it to name %s", err, KeyEnv)
	}
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("the endpoint's own words are worth keeping: %q", err)
	}
}

// Google answers a bad key with 400 INVALID_ARGUMENT inside a JSON array. Read
// as an ordinary 400 it would cost a call per file and lose the message.
func TestCompleteReadsGoogleARefusal(t *testing.T) {
	body := `[{"error":{"code":400,"message":"Invalid Auth key.","status":"INVALID_ARGUMENT"}}]`
	c, rec := fakeAPI(t, "", fails(400, body))

	_, err := c.Complete(context.Background(), hello())
	if !errors.Is(err, ErrRefused) {
		t.Fatalf("err = %v, want ErrRefused", err)
	}
	if !strings.Contains(err.Error(), "Invalid Auth key.") {
		t.Errorf("the endpoint's own words are worth keeping: %q", err)
	}
	if n := len(rec.calls()); n != 1 {
		t.Errorf("%d calls, want 1: a refusal must not be retried", n)
	}
}

// The other direction, and the one that matters more: a 400 that is not about
// the key must stay recoverable, or one bad file ends the whole pass.
func TestAnOrdinaryBadRequestIsNotARefusal(t *testing.T) {
	body := `[{"error":{"code":400,"message":"models/gemini-9 is not found","status":"NOT_FOUND"}}]`
	c, _ := fakeAPI(t, "", fails(400, body))

	_, err := c.Complete(context.Background(), hello())
	if err == nil || errors.Is(err, ErrRefused) {
		t.Fatalf("err = %v, want a plain failure", err)
	}
	if !strings.Contains(err.Error(), "gemini-9 is not found") {
		t.Errorf("%q loses the reason", err)
	}
}

// The real body Google sends on a quota 429. A flat 2s backoff retries straight
// into the same window; the endpoint says how long to wait, so wait that long.
func TestRetryAfterReadsWhatTheEndpointAsked(t *testing.T) {
	quota := `[{"error":{"code":429,"message":"You exceeded your current quota",` +
		`"status":"RESOURCE_EXHAUSTED","details":[` +
		`{"@type":"type.googleapis.com/google.rpc.Help","links":[]},` +
		`{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"6.613045898s"}]}}]`

	for _, tc := range []struct {
		name string
		head http.Header
		body string
		want time.Duration
	}{
		{"google's body", nil, quota, 6613045898 * time.Nanosecond},
		{"the standard header wins", http.Header{"Retry-After": {"9"}}, quota, 9 * time.Second},
		{"nothing asked", nil, `{"error":{"message":"slow down"}}`, 0},
		{"an absurd delay is capped", nil,
			`{"error":{"details":[{"retryDelay":"3600s"}]}}`, maxWait},
		{"not json at all", nil, "gateway timeout", 0},
	} {
		if got := retryAfter(tc.head, []byte(tc.body)); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNewWithoutAKey(t *testing.T) {
	t.Setenv(KeyEnv, "")

	if _, err := New("https://api.openai.com/v1", "gpt-4.1", Credentials{}); err != ErrNoKey {
		t.Fatalf("err = %v, want ErrNoKey", err)
	}
}

func TestNewReadsTheEnvironment(t *testing.T) {
	t.Setenv(KeyEnv, "sk-test")
	t.Setenv(ModelEnv, "llama3")

	c, err := New("http://localhost:11434/v1/", "", Credentials{})
	if err != nil {
		t.Fatal(err)
	}
	if c.Model != "llama3" {
		t.Errorf("model = %q", c.Model)
	}
	if c.Endpoint != "http://localhost:11434/v1" {
		t.Errorf("endpoint = %q, want no trailing slash", c.Endpoint)
	}
}

func TestNewNeedsAModelName(t *testing.T) {
	t.Setenv(KeyEnv, "sk-test")
	t.Setenv(ModelEnv, "")

	if _, err := New("https://api.openai.com/v1", "", Credentials{}); err != ErrNoModel {
		t.Fatalf("err = %v, want ErrNoModel", err)
	}
}

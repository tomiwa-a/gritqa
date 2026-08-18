package draft

import (
	"context"
	"encoding/json"
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

func fakeAPI(t *testing.T, path string, script ...func(w http.ResponseWriter)) (*Local, *api) {
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

	return &Local{Endpoint: srv.URL + path, Model: "gpt-4.1", Key: "sk-test", HTTP: srv.Client()}, rec
}

func (a *api) calls() []chatRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]chatRequest(nil), a.got...)
}

func says(content string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		json.NewEncoder(w).Encode(chatResponse{Choices: []struct {
			Message message `json:"message"`
		}{{Message: message{Role: "assistant", Content: content}}}})
	}
}

func fails(code int, body string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.WriteHeader(code)
		w.Write([]byte(body))
	}
}

func TestDraftAsksInTheOpenAIShape(t *testing.T) {
	l, rec := fakeAPI(t, "/v1", says(minimal))

	p, err := l.Draft(context.Background(), Request{Project: "shop", BaseURL: "http://localhost:8080"})
	if err != nil {
		t.Fatal(err)
	}
	if p.BaseURL != "http://localhost:8080" {
		t.Errorf("baseUrl = %q", p.BaseURL)
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

// One bad reply gets one correction that says what was wrong with it.
func TestDraftCorrectsOneBadReply(t *testing.T) {
	l, rec := fakeAPI(t, "", says("I would rather describe it in prose."), says(minimal))

	if _, err := l.Draft(context.Background(), Request{}); err != nil {
		t.Fatal(err)
	}

	calls := rec.calls()
	if len(calls) != 2 {
		t.Fatalf("%d calls, want 2", len(calls))
	}
	msgs := calls[1].Messages
	if len(msgs) != 4 || msgs[2].Role != "assistant" || msgs[3].Role != "user" {
		t.Fatalf("the correction turn is wrong: %+v", msgs)
	}
	if !strings.Contains(msgs[3].Content, "plan") {
		t.Errorf("the correction does not say what was wrong: %q", msgs[3].Content)
	}
}

func TestDraftGivesUpRatherThanGuess(t *testing.T) {
	l, _ := fakeAPI(t, "", says("no"), says(`{"name":"p","steps":[]}`))

	_, err := l.Draft(context.Background(), Request{})
	if err == nil || !strings.Contains(err.Error(), "could not use") {
		t.Fatalf("err = %v", err)
	}
}

// An endpoint that does not implement response_format still gets used.
func TestDraftFallsBackWhenJSONModeIsRejected(t *testing.T) {
	l, rec := fakeAPI(t, "",
		fails(400, `{"error":{"message":"response_format is not supported"}}`),
		says(minimal))

	if _, err := l.Draft(context.Background(), Request{}); err != nil {
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

func TestDraftRetriesARateLimit(t *testing.T) {
	was := retryDelay
	retryDelay = time.Millisecond
	defer func() { retryDelay = was }()

	l, rec := fakeAPI(t, "", fails(429, `{"error":{"message":"slow down"}}`), says(minimal))

	if _, err := l.Draft(context.Background(), Request{}); err != nil {
		t.Fatal(err)
	}
	if n := len(rec.calls()); n != 2 {
		t.Fatalf("%d calls, want 2", n)
	}
}

// The likely mistake: an sk-ant- key against api.anthropic.com, which speaks
// /v1/messages and 404s the only call GritQA makes.
func TestDraftExplainsANonOpenAIEndpoint(t *testing.T) {
	l, _ := fakeAPI(t, "/v1/messages")
	l.Endpoint = strings.TrimSuffix(l.Endpoint, "/messages")

	_, err := l.Draft(context.Background(), Request{})
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{"chat completions", "proxy"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

func TestDraftExplainsARefusedKey(t *testing.T) {
	l, _ := fakeAPI(t, "", fails(401, `{"error":{"message":"invalid api key"}}`))

	_, err := l.Draft(context.Background(), Request{})
	if err == nil || !strings.Contains(err.Error(), KeyEnv) {
		t.Fatalf("err = %v, want it to name %s", err, KeyEnv)
	}
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("the endpoint's own words are worth keeping: %q", err)
	}
}

// No key means no drafting, exactly as the settings page promises — and it says
// what still works.
func TestNewLocalWithoutAKey(t *testing.T) {
	t.Setenv(KeyEnv, "")

	_, err := NewLocal("https://api.openai.com/v1", "gpt-4.1")
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{KeyEnv, "by hand"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

func TestNewLocalReadsTheEnvironment(t *testing.T) {
	t.Setenv(KeyEnv, "sk-test")
	t.Setenv(ModelEnv, "llama3")

	l, err := NewLocal("http://localhost:11434/v1/", "")
	if err != nil {
		t.Fatal(err)
	}
	if l.Model != "llama3" {
		t.Errorf("model = %q", l.Model)
	}
	if l.Endpoint != "http://localhost:11434/v1" {
		t.Errorf("endpoint = %q, want no trailing slash", l.Endpoint)
	}
}

func TestNewLocalNeedsAModelName(t *testing.T) {
	t.Setenv(KeyEnv, "sk-test")
	t.Setenv(ModelEnv, "")

	if _, err := NewLocal("https://api.openai.com/v1", ""); err == nil {
		t.Fatal("want an error")
	}
}

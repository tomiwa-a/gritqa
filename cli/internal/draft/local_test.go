package draft

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gritqa/cli/internal/model"
)

// chatBody is only what these tests read back off the wire; the transport itself
// is covered in internal/model.
type chatBody struct {
	Messages []model.Message `json:"messages"`
}

func fakeAPI(t *testing.T, reply ...string) (*Local, func() []chatBody) {
	t.Helper()

	var mu sync.Mutex
	var got []chatBody

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in chatBody
		json.NewDecoder(r.Body).Decode(&in)

		mu.Lock()
		got = append(got, in)
		i := len(got) - 1
		mu.Unlock()

		if i >= len(reply) {
			t.Errorf("call %d was not expected", i+1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, `{"choices":[{"message":{"role":"assistant","content":%s}}]}`,
			quote(reply[i]))
	}))
	t.Cleanup(srv.Close)

	l := &Local{Client: &model.Client{
		Endpoint: srv.URL, Model: "gpt-4.1", Key: "sk-test", HTTP: srv.Client(),
	}}
	return l, func() []chatBody {
		mu.Lock()
		defer mu.Unlock()
		return append([]chatBody(nil), got...)
	}
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestDraftFillsInWhatTheModelIsNotAuthorityOn(t *testing.T) {
	l, _ := fakeAPI(t, minimal)

	p, err := l.Draft(context.Background(), Request{Project: "shop", BaseURL: "http://localhost:8080"})
	if err != nil {
		t.Fatal(err)
	}
	if p.BaseURL != "http://localhost:8080" {
		t.Errorf("baseUrl = %q", p.BaseURL)
	}
	if p.Version != 1 {
		t.Errorf("version = %d", p.Version)
	}
}

// One bad reply gets one correction that says what was wrong with it.
func TestDraftCorrectsOneBadReply(t *testing.T) {
	l, calls := fakeAPI(t, "I would rather describe it in prose.", minimal)

	if _, err := l.Draft(context.Background(), Request{}); err != nil {
		t.Fatal(err)
	}

	got := calls()
	if len(got) != 2 {
		t.Fatalf("%d calls, want 2", len(got))
	}
	msgs := got[1].Messages
	if len(msgs) != 4 || msgs[2].Role != "assistant" || msgs[3].Role != "user" {
		t.Fatalf("the correction turn is wrong: %+v", msgs)
	}
	if !strings.Contains(msgs[3].Content, "plan") {
		t.Errorf("the correction does not say what was wrong: %q", msgs[3].Content)
	}
}

func TestDraftGivesUpRatherThanGuess(t *testing.T) {
	l, _ := fakeAPI(t, "no", `{"name":"p","steps":[]}`)

	_, err := l.Draft(context.Background(), Request{})
	if err == nil || !strings.Contains(err.Error(), "could not use") {
		t.Fatalf("err = %v", err)
	}
}

// No key means no drafting, exactly as the settings page promises — and it says
// what still works.
func TestNewLocalWithoutAKey(t *testing.T) {
	t.Setenv(model.KeyEnv, "")

	_, err := NewLocal("https://api.openai.com/v1", "gpt-4.1")
	if err == nil {
		t.Fatal("want an error")
	}
	for _, want := range []string{model.KeyEnv, "by hand"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

func TestNewLocalNeedsAModelName(t *testing.T) {
	t.Setenv(model.KeyEnv, "sk-test")
	t.Setenv(model.ModelEnv, "")

	_, err := NewLocal("https://api.openai.com/v1", "")
	if err == nil || !strings.Contains(err.Error(), "run.model.name") {
		t.Fatalf("err = %v", err)
	}
}

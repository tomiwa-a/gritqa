package cloud

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// relay is the dashboard's half of a dial, small enough to assert against: it
// streams whatever it is given and records what comes back.
type relay struct {
	down chan string

	mu sync.Mutex
	up []string
}

func (r *relay) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(dialPath, func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Query().Get("instanceId") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		flush, _ := w.(http.Flusher)
		// The headers have to reach the client before the first frame, or Dial is
		// still waiting for them while this waits for something to send.
		if flush != nil {
			flush.Flush()
		}
		for line := range r.down {
			io.WriteString(w, line+"\n")
			if flush != nil {
				flush.Flush()
			}
		}
	})
	mux.HandleFunc(replyPath, func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			InstanceID string          `json:"instanceId"`
			Frame      json.RawMessage `json:"frame"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		r.mu.Lock()
		r.up = append(r.up, body.InstanceID+" "+string(body.Frame))
		r.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	return mux
}

func (r *relay) sent() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.up...)
}

// The keepalive is the trap: the SDK decodes one JSON value per line, so a ':' line
// reaching it is a protocol error rather than the no-op it is meant to be.
func TestDialDropsKeepalivesAndPostsWholeFrames(t *testing.T) {
	r := &relay{down: make(chan string, 4)}
	ts := httptest.NewServer(r.handler())
	defer ts.Close()

	c := &Client{Server: ts.URL, Token: "t", HTTP: ts.Client()}
	up, err := c.Dial(context.Background(), "machine-1")
	if err != nil {
		t.Fatal(err)
	}
	defer up.Close()

	r.down <- ": keepalive"
	r.down <- `{"jsonrpc":"2.0","id":1}`
	r.down <- ":"
	r.down <- `{"jsonrpc":"2.0","id":2}`

	lines := bufio.NewScanner(up)
	for _, want := range []string{`{"jsonrpc":"2.0","id":1}`, `{"jsonrpc":"2.0","id":2}`} {
		if !lines.Scan() {
			t.Fatalf("nothing came down where %s should have: %v", want, lines.Err())
		}
		if got := lines.Text(); got != want {
			t.Errorf("read %s, want %s", got, want)
		}
	}

	// Two frames in one Write, then a partial one that must wait for its newline.
	if _, err := up.Write([]byte("{\"a\":1}\n{\"b\":2}\n{\"c\":")); err != nil {
		t.Fatal(err)
	}
	if got := r.sent(); len(got) != 2 {
		t.Fatalf("posted %v, want the two whole frames and not the partial one", got)
	}
	if _, err := up.Write([]byte("3}\n")); err != nil {
		t.Fatal(err)
	}
	got := r.sent()
	want := []string{`machine-1 {"a":1}`, `machine-1 {"b":2}`, `machine-1 {"c":3}`}
	for i := range want {
		if i >= len(got) || got[i] != want[i] {
			t.Fatalf("posted %v, want %v", got, want)
		}
	}

	close(r.down)
}

// Close is called twice, because the MCP transport holds the uplink as both its
// reader and its writer.
func TestClosingAnUplinkTwiceIsFine(t *testing.T) {
	r := &relay{down: make(chan string)}
	ts := httptest.NewServer(r.handler())
	defer ts.Close()

	c := &Client{Server: ts.URL, Token: "t", HTTP: ts.Client()}
	up, err := c.Dial(context.Background(), "machine-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := up.Close(); err != nil {
		t.Fatal(err)
	}
	if err := up.Close(); err != nil {
		t.Fatalf("the second close reported %v", err)
	}
	close(r.down)
}

func TestDialSurfacesARefusal(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, `{"error":"no_relay"}`)
	}))
	defer ts.Close()

	c := &Client{Server: ts.URL, Token: "t", HTTP: ts.Client()}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := c.Dial(ctx, "machine-1")
	var refused *Refused
	if !errors.As(err, &refused) {
		t.Fatalf("a 404 came back as %v", err)
	}
	if refused.Status != http.StatusNotFound || refused.Code != "no_relay" {
		t.Errorf("refusal reads %+v", refused)
	}
}

package mcp

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func server(t *testing.T) *Server {
	t.Helper()
	s, err := New(Options{Root: t.TempDir(), Backend: &stub{}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// The address is advertised to the dashboard, so waiting for it has to be an event
// rather than a guessed duration.
func TestReadyClosesOnceBound(t *testing.T) {
	s := server(t)
	if _, ok := s.Live(); ok {
		t.Fatal("an address was advertised before anything was listening")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Serve(ctx, "127.0.0.1:0")

	select {
	case <-s.Ready():
	case <-time.After(10 * time.Second):
		t.Fatal("Serve never settled, so a caller would wait forever")
	}

	addr, ok := s.Live()
	if !ok || addr == "" {
		t.Fatal("bound and still advertising nothing")
	}
	if _, err := http.Get("http://" + addr); err != nil {
		t.Fatalf("advertised %s and nothing answers there: %v", addr, err)
	}
}

// A port nothing listens on is worse than no port, because it is believed.
func TestLiveEmptiesWhenServingStops(t *testing.T) {
	s := server(t)
	ctx, cancel := context.WithCancel(context.Background())
	go s.Serve(ctx, "127.0.0.1:0")
	<-s.Ready()

	if _, ok := s.Live(); !ok {
		t.Fatal("nothing to stop")
	}
	cancel()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := s.Live(); !ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("serving stopped and the address is still being handed out")
}

// A server that cannot bind must settle Ready too, or whoever waits for it hangs.
func TestReadySettlesWhenBindFails(t *testing.T) {
	s := server(t)
	go s.Serve(context.Background(), "127.0.0.1:70000")

	select {
	case <-s.Ready():
	case <-time.After(10 * time.Second):
		t.Fatal("a failed bind left Ready pending")
	}
	if _, ok := s.Live(); ok {
		t.Fatal("a failed bind advertised an address")
	}
}

package source

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gritqa/cli/internal/model"
)

const phpController = `<?php
class RoomController {
	// index.php?controller=rooms&action=stats
	public function stats() { echo json_encode($this->repo->stats()); }
}
`

func localAPI(t *testing.T, reply string) (*Local, func() string) {
	t.Helper()

	var sent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Messages []model.Message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		if len(in.Messages) > 0 {
			sent = in.Messages[len(in.Messages)-1].Content
		}
		body, _ := json.Marshal(reply)
		fmt.Fprintf(w, `{"choices":[{"message":{"role":"assistant","content":%s}}]}`, body)
	}))
	t.Cleanup(srv.Close)

	l := &Local{Model: &model.Client{
		Endpoint: srv.URL, Model: "m", Key: "sk-test", HTTP: srv.Client(),
	}}
	return l, func() string { return sent }
}

// A query-string route is what the client actually types, so it survives intact.
func TestLocalReadsAQueryStringRoute(t *testing.T) {
	l, prompt := localAPI(t, `Here you go:
{"endpoints":[
  {"method":"GET","path":"/index.php?controller=rooms&action=stats","line":4,
   "handler":"RoomController::stats","middleware":["AdminRequired"]}
]}`)

	got, err := l.Extract(context.Background(), File{
		Path: "controllers/RoomController.php", Language: "php", Content: []byte(phpController),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
	r := got[0]
	if r.Path != "/index.php?controller=rooms&action=stats" || r.Method != "GET" {
		t.Errorf("route = %+v", r)
	}
	if r.Handler != "RoomController::stats" || r.Line != 4 {
		t.Errorf("route = %+v", r)
	}
	if !strings.Contains(prompt(), phpController) {
		t.Error("the file was not sent")
	}
}

// A bare array is the one shape a model reaches for instead of the object.
func TestLocalAcceptsABareArray(t *testing.T) {
	l, _ := localAPI(t, `[{"method":"POST","path":"/index.php?controller=auth&action=login"}]`)

	got, err := l.Extract(context.Background(), File{Path: "a.php", Language: "php"})
	if err != nil || len(got) != 1 || got[0].Method != "POST" {
		t.Fatalf("got %+v, err %v", got, err)
	}
}

func TestLocalReportsAReplyItCannotUse(t *testing.T) {
	l, _ := localAPI(t, "I would rather describe the endpoints in prose.")

	if _, err := l.Extract(context.Background(), File{Path: "a.php"}); err == nil {
		t.Fatal("want an error")
	}
}

// The gateway is sent ahead of the file, labelled, so the model can compose the
// whole URL rather than guess at half of it.
func TestLocalSendsTheGateway(t *testing.T) {
	l, prompt := localAPI(t, `{"endpoints":[]}`)

	_, err := l.Extract(context.Background(), File{
		Path: "controllers/RoomController.php", Language: "php", Content: []byte(phpController),
		Context: []File{{Path: "index.php", Content: []byte("switch ($_GET['controller']) {}")}},
	})
	if err != nil {
		t.Fatal(err)
	}

	got := prompt()
	if !strings.Contains(got, "Gateway: index.php") {
		t.Errorf("the gateway is not labelled: %q", got)
	}
	if strings.Index(got, "index.php") > strings.Index(got, "RoomController.php") {
		t.Error("the gateway should come before the file it routes to")
	}
	if !strings.Contains(got, phpController) {
		t.Error("the file itself was not sent")
	}
}

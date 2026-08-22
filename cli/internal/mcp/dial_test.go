package mcp

import (
	"context"
	"net"
	"path/filepath"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// A dialled surface is read scope whatever the flag says. Approved work arrives as a
// job and goes through the engine, so an execute tool over a relay would be the
// review gate routed around.
func TestADialledSurfaceIsAlwaysReadScope(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "api", "user.php"), "<?php\nfunction show() {}\n")

	srv, err := New(Options{Project: "p", Root: root, Backend: &stub{root: root}, Execute: true})
	if err != nil {
		t.Fatal(err)
	}

	ours, theirs := net.Pipe()
	ctx, stop := context.WithCancel(context.Background())
	defer stop()

	done := make(chan error, 1)
	go func() { done <- srv.Dial(ctx, ours) }()

	cs, err := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil).
		Connect(ctx, &sdk.IOTransport{Reader: theirs, Writer: theirs}, nil)
	if err != nil {
		t.Fatal(err)
	}

	got := names(t, cs)
	for _, want := range []string{"get_index", "read_file", "search"} {
		if !has(got, want) {
			t.Errorf("a dialled client cannot reach %s: %v", want, got)
		}
	}
	for _, gone := range []string{"run_plan", "snapshot", "restore"} {
		if has(got, gone) {
			t.Errorf("%s is advertised over a dial even though nothing approved it", gone)
		}
	}

	cs.Close()
	if err := <-done; err != nil {
		t.Fatalf("a client hanging up is not an error: %v", err)
	}
}

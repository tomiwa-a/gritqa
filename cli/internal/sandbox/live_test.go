package sandbox

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// live is the real thing: Docker, real images, a real boot. Off by default
// because it costs about a minute, and the rest of the package's tests have to
// stay runnable on a machine with no Docker at all.
func live(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("GRITQA_SANDBOX_TEST") != "1" {
		t.Skip("set GRITQA_SANDBOX_TEST=1 to run the Docker-backed tests")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker on PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	t.Cleanup(cancel)
	return ctx
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func get(t *testing.T, url string) string {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

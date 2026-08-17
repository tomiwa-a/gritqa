package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindLocatesConfigFromSubdirectory(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, Dir, Name), "project: api\npath: .\nbranch: main\n")

	deep := filepath.Join(root, "internal", "handlers")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}

	got, hasConfig, err := Find(deep)
	if err != nil {
		t.Fatal(err)
	}
	if !hasConfig {
		t.Error("expected hasConfig")
	}
	if got != root {
		t.Errorf("got root %q, want %q", got, root)
	}
}

func TestFindFallsBackToManifest(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "go.mod"), "module example.com/api\n")

	got, hasConfig, err := Find(filepath.Join(root))
	if err != nil {
		t.Fatal(err)
	}
	if hasConfig {
		t.Error("did not expect hasConfig")
	}
	if got != root {
		t.Errorf("got root %q, want %q", got, root)
	}
}

// A config deeper in the tree wins over a manifest higher up.
func TestFindPrefersConfigOverManifest(t *testing.T) {
	outer := t.TempDir()
	mustWrite(t, filepath.Join(outer, "package.json"), "{}")

	inner := filepath.Join(outer, "services", "api")
	mustWrite(t, filepath.Join(inner, Dir, Name), "project: api\npath: .\nbranch: main\n")

	got, hasConfig, err := Find(inner)
	if err != nil {
		t.Fatal(err)
	}
	if !hasConfig || got != inner {
		t.Errorf("got (%q, %v), want (%q, true)", got, hasConfig, inner)
	}
}

func TestFindWithoutAnythingRecognisable(t *testing.T) {
	if _, _, err := Find(t.TempDir()); err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

// First run writes exactly the three keys the onboarding wizard shows.
func TestSaveWritesTheThreeLineConfig(t *testing.T) {
	root := filepath.Join(t.TempDir(), "payments-api")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := New(root, "main").Save(); err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(filepath.Join(root, Dir, Name))
	if err != nil {
		t.Fatal(err)
	}

	want := "project: payments-api\npath: " + collapseHome(root) + "\nbranch: main\n"
	if string(b) != want {
		t.Errorf("got:\n%s\nwant:\n%s", b, want)
	}
}

func TestLoadRoundTripsRunBlock(t *testing.T) {
	root := t.TempDir()
	cfg := New(root, "main")
	cfg.Run = &Run{
		Start:   "go run ./cmd/api",
		Port:    8080,
		Ready:   "GET /health",
		Migrate: "go run ./cmd/migrate up",
		Env:     map[string]string{"DATABASE_URL": "$GRITQA_DATABASE_URL"},
	}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}

	got, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Run == nil {
		t.Fatal("run block was lost")
	}
	if got.Run.Start != cfg.Run.Start || got.Run.Port != 8080 {
		t.Errorf("got %+v", got.Run)
	}
	if got.Run.Env["DATABASE_URL"] != "$GRITQA_DATABASE_URL" {
		t.Errorf("env lost: %+v", got.Run.Env)
	}
	if got.Run.Seed != "" {
		t.Errorf("empty seed should stay empty, got %q", got.Run.Seed)
	}
}

func TestLoadRejectsConfigWithoutProject(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, Dir, Name), "path: .\nbranch: main\n")

	if _, err := Load(root); err == nil {
		t.Error("expected an error for a config with no project name")
	}
}

func TestLoadMissingIsErrNotFound(t *testing.T) {
	if _, err := Load(t.TempDir()); err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestResolvedBaseURL(t *testing.T) {
	cases := []struct {
		name string
		run  *Run
		want string
	}{
		{"nil", nil, ""},
		{"port only", &Run{Port: 8080}, "http://localhost:8080"},
		{"explicit wins", &Run{Port: 8080, BaseURL: "http://127.0.0.1:3000"}, "http://127.0.0.1:3000"},
		{"trailing slash trimmed", &Run{BaseURL: "http://localhost:9000/"}, "http://localhost:9000"},
		{"nothing set", &Run{}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.run.ResolvedBaseURL(); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestReadyProbe(t *testing.T) {
	cases := []struct {
		in           string
		method, path string
		ok           bool
	}{
		{"GET /health", "GET", "/health", true},
		{"/health", "GET", "/health", true},
		{"post /readyz", "POST", "/readyz", true},
		{"", "", "", false},
		{"GET /health extra", "", "", false},
	}
	for _, c := range cases {
		m, p, ok := (&Run{Ready: c.in}).ReadyProbe()
		if m != c.method || p != c.path || ok != c.ok {
			t.Errorf("ReadyProbe(%q) = (%q, %q, %v), want (%q, %q, %v)",
				c.in, m, p, ok, c.method, c.path, c.ok)
		}
	}
}

func TestExpandRoundTripsCollapseHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}

	p := filepath.Join(home, "code", "payments-api")
	collapsed := collapseHome(p)
	if collapsed != filepath.Join("~", "code", "payments-api") {
		t.Fatalf("collapseHome = %q", collapsed)
	}
	if got := Expand(collapsed); got != p {
		t.Errorf("Expand(%q) = %q, want %q", collapsed, got, p)
	}
}

func TestCollapseHomeLeavesOutsidePathsAlone(t *testing.T) {
	if got := collapseHome("/opt/src/api"); got != "/opt/src/api" {
		t.Errorf("got %q", got)
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
		Port:      8080,
		Ready:     "GET /health",
		Variables: map[string]string{"adminPassword": "$GRITQA_ADMIN_PASSWORD"},
		Sandbox: &Sandbox{
			Compose: []string{"compose.yaml"},
			Environment: &Environment{
				App: "web", Port: 80, Database: "db", DBPort: 3306, Driver: "mysql",
				Login:  Login{User: "$DB_USER", Password: "$DB_PASSWORD", Name: "$DB_NAME"},
				Schema: []SchemaStep{{Service: "migrate"}, {Service: "web", Run: []string{"sh", "-c", "seed"}}},
			},
		},
	}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}

	got, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Run == nil || !got.Run.Sandboxed() {
		t.Fatal("run block was lost")
	}
	if got.Run.Port != 8080 || got.Run.Variables["adminPassword"] != "$GRITQA_ADMIN_PASSWORD" {
		t.Errorf("got %+v", got.Run)
	}
	e := got.Run.SandboxOpts().Environment
	if e == nil || e.App != "web" || e.Login.Password != "$DB_PASSWORD" {
		t.Fatalf("the environment did not survive: %+v", e)
	}
	// A credential is named, never carried: it is read out of the database service's
	// own environment once the copy is up.
	if len(e.Schema) != 2 || e.Schema[1].Run[2] != "seed" {
		t.Errorf("the schema steps did not survive: %+v", e.Schema)
	}
	if len(got.Retired()) != 0 {
		t.Errorf("a config of only live keys reports %v as retired", got.Retired())
	}
}

// A retired key decodes into nothing, so without this it would go on sitting in
// someone's file looking like it still chose the image.
func TestRetiredKeysAreNamed(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, Dir, Name), `project: hotel-api
run:
  port: 8080
  migrate: phinx migrate
  sandbox:
    image: mysql:8
    tables: [guests]
`)
	got, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"run.migrate", "run.sandbox.image"}
	if fmt.Sprint(got.Retired()) != fmt.Sprint(want) {
		t.Errorf("Retired() = %v, want %v", got.Retired(), want)
	}
	if got.Run.Port != 8080 || len(got.Run.SandboxOpts().Tables) != 1 {
		t.Error("the live keys beside them stopped being read")
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

func TestResolvedVariables(t *testing.T) {
	t.Setenv("GRITQA_ADMIN_PASSWORD", "s3cret")
	t.Setenv("GRITQA_EMPTY", "")

	run := &Run{Variables: map[string]string{
		"adminEmail":    "admin@hotel.test",
		"adminPassword": "$GRITQA_ADMIN_PASSWORD",
		"braced":        "${GRITQA_ADMIN_PASSWORD}",
		"priced":        "$9.99 plan",
		"bare":          "$",
		"unset":         "$GRITQA_NOT_EXPORTED",
		"blank":         "$GRITQA_EMPTY",
	}}

	v := run.ResolvedVariables()
	want := map[string]string{
		"adminEmail":    "admin@hotel.test",
		"adminPassword": "s3cret",
		"braced":        "s3cret",
		"priced":        "$9.99 plan",
		"bare":          "$",
	}
	for k, w := range want {
		if v.Values[k] != w {
			t.Errorf("%s: got %q, want %q", k, v.Values[k], w)
		}
	}
	if len(v.Values) != len(want) {
		t.Errorf("an unresolved name must not be passed on: %+v", v.Values)
	}

	// Only what came from the environment is worth masking: a value written into
	// the config file is committed already.
	if strings.Join(v.Secret, " ") != "adminPassword braced" {
		t.Errorf("secret = %+v", v.Secret)
	}

	// An exported-but-empty variable is missing, not empty: an empty admin
	// password fails every guarded step with a 401 that explains nothing.
	got := strings.Join(v.Missing, " ")
	for _, want := range []string{"blank ($GRITQA_EMPTY)", "unset ($GRITQA_NOT_EXPORTED)"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing should name %s, got %q", want, got)
		}
	}
	if len(v.Missing) != 2 {
		t.Errorf("got %q", got)
	}
}

// A short value masked everywhere it occurs would shred every URL it appears
// inside, so it is left alone.
func TestSecretsAreEnvSourcedAndLongEnough(t *testing.T) {
	t.Setenv("GRITQA_PASSWORD", "s3cret")
	t.Setenv("GRITQA_PIN", "99")

	run := &Run{Variables: map[string]string{
		"password": "$GRITQA_PASSWORD",
		"pin":      "$GRITQA_PIN",
		"written":  "in-the-config-file",
	}}

	if got := run.ResolvedVariables().Secrets(); len(got) != 1 || got[0] != "s3cret" {
		t.Errorf("got %+v", got)
	}
}

func TestResolvedVariablesWithoutAny(t *testing.T) {
	for _, run := range []*Run{nil, {}, {Variables: map[string]string{}}} {
		v := run.ResolvedVariables()
		if len(v.Values) != 0 || len(v.Missing) != 0 || len(v.Secrets()) != 0 {
			t.Errorf("%+v gave %+v", run, v)
		}
	}
	if names := (*Run)(nil).VariableNames(); names != nil {
		t.Errorf("got %+v", names)
	}
}

func TestVariableNamesAreSortedAndValuesNeverLeave(t *testing.T) {
	run := &Run{Variables: map[string]string{
		"adminPassword": "$GRITQA_ADMIN_PASSWORD", "adminEmail": "admin@hotel.test",
	}}
	got := run.VariableNames()
	if len(got) != 2 || got[0] != "adminEmail" || got[1] != "adminPassword" {
		t.Fatalf("got %+v", got)
	}
	for _, n := range got {
		if strings.Contains(n, "@") || strings.Contains(n, "$") {
			t.Errorf("a name carried its value: %q", n)
		}
	}
}

package app

import (
	"bytes"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/creds"
	"github.com/tomiwa-a/gritqa/cli/internal/index/source"
	"github.com/tomiwa-a/gritqa/cli/internal/model"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

// isolate points creds at a temp home, so a real login on this machine cannot
// decide the outcome either way.
func isolate(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
}

func modelConfig(t *testing.T) *config.Config {
	cfg := config.New(t.TempDir(), "main")
	cfg.Run = &config.Run{Model: &config.Model{
		Endpoint: "https://api.deepseek.com/v1", Name: "deepseek-v4-flash",
	}}
	return cfg
}

// The user's own key needs no server, so it wins.
func TestExtractorPrefersTheKey(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "sk-test")

	var out bytes.Buffer
	got := extractor(term.New(&out), Options{}, modelConfig(t))

	if _, ok := got.(*source.Local); !ok {
		t.Fatalf("got %T, want the local extractor", got)
	}
}

func TestExtractorFallsBackToALogin(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "")

	opts := Options{Server: "https://app.gritqa.dev"}
	cfg := modelConfig(t)
	store, err := creds.Open()
	if err != nil {
		t.Fatal(err)
	}
	key := creds.Key{Server: opts.server(), Root: cfg.Root()}
	if err := store.Set(key, creds.Entry{Token: "t"}); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	got := extractor(term.New(&out), opts, cfg)

	c, ok := got.(*source.Client)
	if !ok {
		t.Fatalf("got %T, want the server extractor", got)
	}
	if c.Token != "t" {
		t.Errorf("token = %q", c.Token)
	}
}

// Neither, and the line says which two things would fix it.
func TestExtractorSaysWhatIsMissing(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "")

	var out bytes.Buffer
	if got := extractor(term.New(&out), Options{}, modelConfig(t)); got != nil {
		t.Fatalf("got %T, want nothing", got)
	}
	for _, want := range []string{model.KeyEnv, "login"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("%q does not mention %q", out.String(), want)
		}
	}
}

// A key with no model to spend it on is a misconfiguration, said plainly.
func TestExtractorNeedsAModelName(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "sk-test")
	t.Setenv(model.ModelEnv, "")

	cfg := config.New(t.TempDir(), "main")
	var out bytes.Buffer
	if got := extractor(term.New(&out), Options{}, cfg); got != nil {
		t.Fatalf("got %T, want nothing", got)
	}
	if !strings.Contains(out.String(), "run.model.name") {
		t.Errorf("got %q", out.String())
	}
}

// A token command needs no key and no login, and a stale export lying around
// must not be picked over it silently.
func TestExtractorPrefersATokenCommand(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "sk-exported-an-hour-ago")

	cfg := modelConfig(t)
	cfg.Run.Model.TokenCommand = "printf minted"

	var out bytes.Buffer
	got := extractor(term.New(&out), Options{}, cfg)

	if _, ok := got.(*source.Local); !ok {
		t.Fatalf("got %T, want the local extractor", got)
	}
	if !strings.Contains(out.String(), "token_command") {
		t.Errorf("%q does not say which bearer is in use", out.String())
	}
}

func TestATokenCommandAloneIsEnough(t *testing.T) {
	isolate(t)
	t.Setenv(model.KeyEnv, "")

	cfg := modelConfig(t)
	cfg.Run.Model.TokenCommand = "printf minted"

	var out bytes.Buffer
	if got := extractor(term.New(&out), Options{}, cfg); got == nil {
		t.Fatalf("got nothing, want the local extractor: %q", out.String())
	}
	if out.Len() != 0 {
		t.Errorf("nothing is wrong, so nothing should be said: %q", out.String())
	}
}

package model

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// counter is a token command that prints a different bearer on every run, so a
// reused one and a re-minted one are told apart by value.
func counter(t *testing.T) *Command {
	t.Helper()
	n := filepath.Join(t.TempDir(), "mints")
	return &Command{Line: "printf x >> " + n + "; wc -c < " + n + " | tr -d ' '"}
}

func mint(t *testing.T, c *Command) string {
	t.Helper()
	tok, err := c.Token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestStaticCannotGoStale(t *testing.T) {
	s := Static("sk-test")

	if tok, err := s.Token(context.Background()); err != nil || tok != "sk-test" {
		t.Fatalf("token = %q, %v", tok, err)
	}
	if s.Stale() {
		t.Error("an exported key cannot be refreshed, so a refusal has to stay a refusal")
	}
	if s.String() != KeyEnv {
		t.Errorf("source = %q, want %s", s, KeyEnv)
	}
}

func TestACachedTokenIsReused(t *testing.T) {
	c := counter(t)

	if first, again := mint(t, c), mint(t, c); first != again {
		t.Errorf("minted twice inside the TTL: %q then %q", first, again)
	}
}

func TestAnExpiredTokenIsReminted(t *testing.T) {
	c := counter(t)
	c.TTL = time.Nanosecond

	if first, again := mint(t, c), mint(t, c); first == again {
		t.Errorf("both calls got %q, want a fresh mint past the TTL", first)
	}
}

// Minting costs about a second and the extraction pass runs four workers, so
// they have to share one mint rather than shell out at once.
func TestConcurrentCallersMintOnce(t *testing.T) {
	c := counter(t)

	var wg sync.WaitGroup
	got := make([]string, 8)
	errs := make([]error, 8)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i], errs[i] = c.Token(context.Background())
		}(i)
	}
	wg.Wait()

	for i, tok := range got {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if tok != "1" {
			t.Fatalf("caller %d got %q, want the one mint all 8 should share", i, tok)
		}
	}
}

func TestAFailedMintKeepsTheCommandsOwnWords(t *testing.T) {
	c := &Command{Line: `echo "ERROR: (gcloud) Unknown account." >&2; exit 1`}

	_, err := c.Token(context.Background())
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "Unknown account.") {
		t.Errorf("%q loses the reason a user could act on", err)
	}
}

func TestAMintThatPrintsNothingIsAnError(t *testing.T) {
	c := &Command{Line: "true"}

	if _, err := c.Token(context.Background()); err == nil {
		t.Fatal("want an error")
	}
}

func TestStaleKeepsATokenAnotherWorkerJustMinted(t *testing.T) {
	c := counter(t)
	first := mint(t, c)

	if !c.Stale() {
		t.Fatal("a minted token can always be asked for again")
	}
	if again := mint(t, c); again != first {
		t.Errorf("replaced a mint %q from moments ago with %q", first, again)
	}

	withoutGrace(t)
	if !c.Stale() {
		t.Fatal("Stale() = false")
	}
	if again := mint(t, c); again == first {
		t.Errorf("kept %q, want it dropped", first)
	}
}

func withoutGrace(t *testing.T) {
	t.Helper()
	was := grace
	grace = 0
	t.Cleanup(func() { grace = was })
}

// The point of a minted bearer: one that expires between two calls is refreshed
// and retried, not reported as a bad key.
func TestARefusedMintIsRetriedWithAFreshOne(t *testing.T) {
	withoutGrace(t)
	c, rec := fakeAPI(t, "",
		fails(401, `{"error":{"message":"Request had invalid authentication credentials."}}`),
		says("hi"))
	c.Auth = counter(t)

	if _, err := c.Complete(context.Background(), hello()); err != nil {
		t.Fatal(err)
	}
	if n := len(rec.calls()); n != 2 {
		t.Fatalf("%d calls, want 2", n)
	}
	if rec.auth[0] == rec.auth[1] {
		t.Errorf("the retry reused the refused bearer %q", rec.auth[0])
	}
}

func TestASecondRefusalIsARealRefusal(t *testing.T) {
	withoutGrace(t)
	refuse := func(w http.ResponseWriter) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":{"message":"invalid authentication credentials"}}`))
	}
	c, rec := fakeAPI(t, "", refuse, refuse)
	c.Auth = counter(t)

	_, err := c.Complete(context.Background(), hello())
	if err == nil || !strings.Contains(err.Error(), "run.model.token_command") {
		t.Fatalf("err = %v, want it to name where the bearer came from", err)
	}
	if n := len(rec.calls()); n != 2 {
		t.Errorf("%d calls, want 2: a second refusal must not mint again", n)
	}
}

func TestTheTokenCommandWinsOverTheEnvironment(t *testing.T) {
	t.Setenv(KeyEnv, "sk-exported-an-hour-ago")

	c, err := New("https://x/v1", "m", Credentials{Command: "printf minted"})
	if err != nil {
		t.Fatal(err)
	}
	if tok, err := c.Auth.Token(context.Background()); err != nil || tok != "minted" {
		t.Fatalf("token = %q, %v", tok, err)
	}
}

func TestTheEnvironmentIsUsedWhenNoCommandIsSet(t *testing.T) {
	t.Setenv(KeyEnv, "sk-test")

	c, err := New("https://x/v1", "m", Credentials{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Auth.(Static); !ok {
		t.Fatalf("auth = %T, want Static", c.Auth)
	}
}

package mcp

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"
)

// Scope is what a client is allowed to reach. MCP has no per-tool
// authorization, so scope decides which tools are *advertised*: a read client is
// not refused run_plan, it never learns it exists.
type Scope string

const (
	Read    Scope = "read"
	Execute Scope = "execute"
)

// allows is true when a tool in want is reachable at this scope. Execute is a
// superset, because an orchestrator researches as well as runs.
func (s Scope) allows(want Scope) bool {
	return want == Read || s == Execute
}

// keyring maps a bearer to a scope. Tokens are minted per process and never
// written to disk: the CLI prints them, and a restart invalidates them.
type keyring struct {
	tokens map[Scope]string
}

func newKeyring(scopes ...Scope) (keyring, error) {
	k := keyring{tokens: map[Scope]string{}}
	for _, s := range scopes {
		t, err := mint()
		if err != nil {
			return k, err
		}
		k.tokens[s] = t
	}
	return k, nil
}

func mint() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// session mints an id that says which scope opened it. The scope is not a secret
// — the bearer is — so naming it here costs nothing and is what makes the check
// in sessionMatches possible.
func session(s Scope) string {
	token, err := mint()
	if err != nil {
		return string(s) + "-"
	}
	return string(s) + "-" + token
}

// sessionMatches is true when a session id was issued to this scope. An id we
// never minted matches nothing.
func sessionMatches(id string, s Scope) bool {
	at := strings.Index(id, "-")
	return at > 0 && Scope(id[:at]) == s
}

// scope reads the bearer off a request. Compared in constant time, and against
// every token rather than the one a prefix suggests, so a mismatch tells an
// attacker only that it was wrong.
func (k keyring) scope(r *http.Request) (Scope, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return "", false
	}
	token := strings.TrimSpace(header[7:])
	if token == "" {
		return "", false
	}
	var found Scope
	var ok bool
	for s, want := range k.tokens {
		if subtle.ConstantTimeCompare([]byte(token), []byte(want)) == 1 {
			found, ok = s, true
		}
	}
	return found, ok
}

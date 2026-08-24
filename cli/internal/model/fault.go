package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrRefused is a bad key, or a key without access. Sending a second file with
// it is pointless, which is what callers use this to decide.
var ErrRefused = errors.New("refused the key")

// ErrHopeless marks a call a second attempt cannot fix. A rate limit or a server
// error is the moment being wrong and worth waiting out; a 4xx is the request
// being wrong, and sending it again only spends another call.
var ErrHopeless = errors.New("the request itself was rejected")

// Throttle is the endpoint declining to look at the request yet. It is worth
// separating from every other failure because the thing it is protecting is
// shared: a quota belongs to the deployment, so the wait it asks for is owed by
// every caller at once, not by the one request that happened to hit it.
type Throttle struct {
	// Wait is what the endpoint asked for, or zero when it named no delay.
	Wait time.Duration
	err  error
}

func (t *Throttle) Error() string { return t.err.Error() }
func (t *Throttle) Unwrap() error { return t.err }

// Throttled marks err as a quota answer. Exported because the same condition
// arrives through GritQA's own server, which relays the provider it called.
func Throttled(err error, wait time.Duration) error {
	return &Throttle{Wait: wait, err: err}
}

// fault turns a bad status into something the user can act on. The likely
// mistake is an sk-ant- key against api.anthropic.com, which speaks
// /v1/messages and 404s the only call GritQA makes.
func fault(url, endpoint, source string, code int, body []byte) error {
	detail := apiError(body)

	switch {
	case code == http.StatusNotFound:
		return fmt.Errorf("%s has no chat completions endpoint — GritQA speaks the "+
			"OpenAI chat API, so an Anthropic base URL needs a compatibility proxy in front", url)
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return refused(endpoint, source, detail)
	case code == http.StatusBadRequest && strings.Contains(string(body), "response_format"):
		return errJSONMode
	// Google answers a bad key with 400, not 401, so without this a wrong key
	// costs one call per file instead of one call in total.
	case code == http.StatusBadRequest && badKey(detail):
		return refused(endpoint, source, detail)
	}
	if code < http.StatusInternalServerError && code != http.StatusTooManyRequests {
		return fmt.Errorf("%s answered %d%s: %w", url, code, detail, ErrHopeless)
	}
	return fmt.Errorf("%s answered %d%s", url, code, detail)
}

func refused(endpoint, source, detail string) error {
	return fmt.Errorf("%s %w from %s%s", endpoint, ErrRefused, source, detail)
}

// badKey matches only phrases that can mean nothing else: a 400 read as a
// refusal ends the pass, so a model-not-found must not land here.
func badKey(detail string) bool {
	lower := strings.ToLower(detail)
	for _, s := range []string{
		"invalid auth key", "api key not valid", "api_key_invalid", "invalid api key",
	} {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

// unwrap takes the error out of either shape: OpenAI's bare object, or the
// single-element array Google wraps the same thing in.
func unwrap(body []byte) []byte {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return body
	}
	var many []json.RawMessage
	if err := json.Unmarshal(trimmed, &many); err != nil || len(many) == 0 {
		return body
	}
	return many[0]
}

func apiError(body []byte) string {
	var out struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(unwrap(body), &out); err != nil || out.Error.Message == "" {
		return ""
	}
	return ": " + out.Error.Message
}

// retryAfter reads how long the endpoint asked us to wait — the standard header,
// or the retryDelay Google buries in the body. A flat backoff against a quota
// window spends the one retry on another 429.
func retryAfter(h http.Header, body []byte) time.Duration {
	if secs, err := strconv.Atoi(h.Get("Retry-After")); err == nil && secs > 0 {
		return atMost(time.Duration(secs) * time.Second)
	}

	var out struct {
		Error struct {
			Details []struct {
				RetryDelay string `json:"retryDelay"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(unwrap(body), &out); err != nil {
		return 0
	}
	for _, d := range out.Error.Details {
		if wait, err := time.ParseDuration(d.RetryDelay); err == nil && wait > 0 {
			return atMost(wait)
		}
	}
	return 0
}

// maxWait keeps a misreported delay from parking the whole pass.
const maxWait = 30 * time.Second

func atMost(d time.Duration) time.Duration {
	if d > maxWait {
		return maxWait
	}
	return d
}

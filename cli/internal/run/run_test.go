package run

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gritqa/cli/internal/plan"
)

func parse(t *testing.T, steps string) *plan.Plan {
	t.Helper()
	p, err := plan.Parse([]byte(`{"name":"p","version":1,"description":"","baseUrl":"",
		"variables":{"email":"qa@gritqa.dev"},"steps":[` + steps + `]}`))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func exec(t *testing.T, base string, p *plan.Plan) *Result {
	t.Helper()
	res, err := (&Engine{BaseURL: base}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func statuses(res *Result) string {
	out := make([]string, len(res.Steps))
	for i, s := range res.Steps {
		out[i] = s.ID + ":" + string(s.Status)
	}
	return strings.Join(out, " ")
}

// The whole chain: a token extracted into a header, an id into a URL, and a
// number extracted then compared against as a string.
func TestRunChainsVariables(t *testing.T) {
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/login":
			w.Write([]byte(`{"data":{"token":"t_1","user":{"id":"u_1"}}}`))
		case "/checkout/quote":
			auth = r.Header.Get("Authorization")
			w.Write([]byte(`{"data":{"quote_id":"q_1","tax_total":66750}}`))
		case "/checkout/q_1/tax":
			w.Write([]byte(`{"data":{"tax_total":66750}}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	res := exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"POST","url":"/auth/login",
			"body":{"email":"{{email}}"}},
		 "extract":[{"name":"authToken","path":"$.data.token","source":"body"}],
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s2","dependsOn":["s1"],"request":{"method":"POST","url":"/checkout/quote",
			"headers":{"Authorization":"Bearer {{authToken}}"}},
		 "extract":[{"name":"quoteId","path":"$.data.quote_id","source":"body"},
			{"name":"taxTotal","path":"$.data.tax_total","source":"body"}],
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s3","dependsOn":["s2"],"request":{"method":"POST","url":"/checkout/{{quoteId}}/tax"},
		 "assertions":[
			{"type":"status","operator":"equals","target":"status","expected":200},
			{"type":"bodyField","operator":"equals","target":"data.tax_total","expected":"{{taxTotal}}"}]}`))

	if res.Status != RunPassed {
		t.Fatalf("%s — %s", res.Status, statuses(res))
	}
	if auth != "Bearer t_1" {
		t.Errorf("Authorization = %q", auth)
	}
	if res.Vars["taxTotal"] != "66750" {
		t.Errorf("taxTotal = %q, want the number as text", res.Vars["taxTotal"])
	}
}

// abort stops the run: everything after it was never reached, which is pending,
// not skipped.
func TestRunAbortLeavesTheRestPending(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/boom" {
			w.WriteHeader(500)
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	res := exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s2","dependsOn":["s1"],"request":{"method":"GET","url":"/boom"},"onFailure":"abort",
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s3","dependsOn":["s2"],"request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s4","request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if got := statuses(res); got != "s1:passed s2:failed s3:pending s4:pending" {
		t.Fatalf("got %s", got)
	}
	if res.Status != RunFailed {
		t.Errorf("run = %s, want failed", res.Status)
	}
	if len(res.Steps[1].Checks) != 1 || res.Steps[1].Checks[0].Actual != "500" {
		t.Errorf("the failing check should say what it got: %+v", res.Steps[1].Checks)
	}
}

// continue keeps independent branches running; it does not fabricate the inputs
// a dependent step never got.
func TestRunContinueSkipsOnlyDependents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/boom" {
			w.WriteHeader(500)
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	res := exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/boom"},"onFailure":"continue",
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s2","dependsOn":["s1"],"request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]},
		{"id":"s3","request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if got := statuses(res); got != "s1:failed s2:skipped s3:passed" {
		t.Fatalf("got %s", got)
	}
	if !strings.Contains(res.Steps[1].Err, "s1") {
		t.Errorf("a skipped step should name what blocked it: %q", res.Steps[1].Err)
	}
}

// A harness that could not reach the API found no bug: that is error, not failed.
func TestRunTransportFailureIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	base := srv.URL
	srv.Close()

	res := exec(t, base, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/ok"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if res.Status != RunErrored || res.Steps[0].Status != StepError {
		t.Fatalf("%s — %s", res.Status, statuses(res))
	}
	if res.Steps[0].Err == "" {
		t.Error("an error step has to say what went wrong")
	}
}

// A variable no step bound is an error too: the step never asserted anything.
func TestRunUnboundVariableIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	res := exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/orders/{{ghost}}"},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if res.Steps[0].Status != StepError || !strings.Contains(res.Steps[0].Err, "ghost") {
		t.Fatalf("%s: %q", res.Steps[0].Status, res.Steps[0].Err)
	}
}

func TestRunRetriesUntilItPasses(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	res := exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/ok"},"retry":{"maxAttempts":2,"delayMs":1},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if res.Status != RunPassed {
		t.Fatalf("%s — %s", res.Status, statuses(res))
	}
	if res.Steps[0].Attempts != 2 {
		t.Errorf("attempts = %d, want 2", res.Steps[0].Attempts)
	}
}

// maxAttempts is a total, so 1 sends once.
func TestRunOneAttemptSendsOnce(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(500)
	}))
	defer srv.Close()

	exec(t, srv.URL, parse(t, `
		{"id":"s1","request":{"method":"GET","url":"/ok"},"retry":{"maxAttempts":1,"delayMs":0},
		 "assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`))

	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Fatalf("sent %d times, want 1", n)
	}
}

// A run that found a bug reports the bug, even if something else also broke.
func TestStatusOfPrefersFailed(t *testing.T) {
	got := statusOf([]StepResult{{Status: StepError}, {Status: StepFailed}})
	if got != RunFailed {
		t.Fatalf("got %s, want failed", got)
	}
	if statusOf([]StepResult{{Status: StepPassed}, {Status: StepError}}) != RunErrored {
		t.Error("an error with nothing failed is an error")
	}
	if statusOf([]StepResult{{Status: StepPassed}, {Status: StepSkipped}}) != RunPassed {
		t.Error("skipped is not a failure on its own")
	}
}

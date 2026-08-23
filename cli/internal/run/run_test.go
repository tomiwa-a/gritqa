package run

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"

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

// A signup step needs a unique email or the second run fails on the row the
// first one left behind, and the plan format has no functions to make one.
func TestRunSeedsAUniqueRunID(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.URL.Query().Get("email"))
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	p := &plan.Plan{Name: "signup", Steps: []plan.Step{{
		ID:      "s1",
		Request: plan.Request{Method: "POST", URL: "/signup", Query: map[string]string{"email": "g-{{runId}}@example.com"}},
		Assertions: []plan.Assertion{
			{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(200)},
		},
	}}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	e := &Engine{BaseURL: srv.URL}
	for range 2 {
		time.Sleep(2 * time.Millisecond)
		r, err := e.Run(context.Background(), p)
		if err != nil {
			t.Fatal(err)
		}
		if r.Status != RunPassed {
			t.Fatalf("status = %s: %+v", r.Status, r.Steps)
		}
	}

	if len(got) != 2 || got[0] == got[1] {
		t.Fatalf("emails = %v, want two different ones", got)
	}
	if strings.Contains(got[0], "{{") {
		t.Errorf("runId was not substituted: %q", got[0])
	}
}

// A credential enters a run here and nowhere else: the plan names it, the
// config supplies it, and the config wins because it describes this machine.
func TestEngineVariablesWinOverThePlans(t *testing.T) {
	var sent map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent = map[string]string{
			"email":  r.URL.Query().Get("email"),
			"pass":   r.URL.Query().Get("pass"),
			"seeded": r.URL.Query().Get("seeded"),
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	p := &plan.Plan{
		Name:      "sign in as admin",
		Variables: map[string]string{"adminEmail": "drafted@example.com", "kept": "from the plan"},
		Steps: []plan.Step{{
			ID: "s1",
			Request: plan.Request{Method: "POST", URL: "/login", Query: map[string]string{
				"email": "{{adminEmail}}", "pass": "{{adminPassword}}", "seeded": "{{kept}}",
			}},
			Assertions: []plan.Assertion{
				{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(200)},
			},
		}},
	}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	e := &Engine{BaseURL: srv.URL, Variables: map[string]string{
		"adminEmail": "admin@hotel.test", "adminPassword": "s3cret",
	}}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps)
	}

	want := map[string]string{"email": "admin@hotel.test", "pass": "s3cret", "seeded": "from the plan"}
	for k, v := range want {
		if sent[k] != v {
			t.Errorf("%s = %q, want %q", k, sent[k], v)
		}
	}
}

// M7d: SQL and shell step execution.

func TestShellStepPassesWhenCommandSucceeds(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"shell","action":{"command":"echo hello"},
		"assertions":[{"type":"exitCode","operator":"equals","target":"exitCode","expected":0}]}`)

	e := &Engine{
		ShellExec: func(ctx context.Context, cmd string) (string, string, int, error) {
			if cmd != "echo hello" {
				t.Errorf("command = %q, want 'echo hello'", cmd)
			}
			return "hello", "", 0, nil
		},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps)
	}
	if res.Steps[0].Stdout != "hello" {
		t.Errorf("stdout = %q", res.Steps[0].Stdout)
	}
	if res.Steps[0].ExitCode != 0 {
		t.Errorf("exitCode = %d", res.Steps[0].ExitCode)
	}
}

func TestShellStepFailsWhenAssertionFails(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"shell","action":{"command":"ls"},
		"assertions":[{"type":"exitCode","operator":"equals","target":"exitCode","expected":0}]}`)

	e := &Engine{
		ShellExec: func(ctx context.Context, cmd string) (string, string, int, error) {
			return "", "no such file or directory", 1, nil
		},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunFailed {
		t.Fatalf("status = %s, want failed", res.Status)
	}
}

func TestShellStepStdoutContainsAssertion(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"shell","action":{"command":"cat /etc/hosts"},
		"assertions":[{"type":"stdoutContains","operator":"contains","target":"stdout","expected":"localhost"}]}`)

	e := &Engine{
		ShellExec: func(ctx context.Context, cmd string) (string, string, int, error) {
			return "127.0.0.1 localhost", "", 0, nil
		},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps)
	}
}

// A run with nothing to execute against is refused before the first step, not on
// the step itself. On step five, four steps have already written things.
func TestShellStepWithNoContainerRefusesTheRun(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"shell","action":{"command":"echo hi"},
		"assertions":[{"type":"exitCode","operator":"equals","target":"exitCode","expected":0}]}`)

	res, err := (&Engine{}).Run(context.Background(), p)
	if err == nil {
		t.Fatalf("the run went ahead: %+v", res)
	}
	if !strings.Contains(err.Error(), "container") {
		t.Errorf("the reason does not say why: %v", err)
	}
}

func TestSQLStepWithNoDatabaseRefusesTheRun(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"sql","action":{"statement":"SELECT 1"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowCount","expected":1}]}`)

	res, err := (&Engine{}).Run(context.Background(), p)
	if err == nil {
		t.Fatalf("the run went ahead: %+v", res)
	}
	if !strings.Contains(err.Error(), "database") {
		t.Errorf("the reason does not say why: %v", err)
	}
}

// The one question this step type exists to answer: the endpoint said 201, and a
// query is what decides whether a row is there. A verify step queries, so it has
// rows to count -- through Exec it had none and the assertion could not fail.
func TestSQLVerifyStepCountsRowsAQueryReturned(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE bookings (id INTEGER, total INTEGER)`)
	mustExec(t, db, `INSERT INTO bookings VALUES (1, 250), (2, 400)`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"SELECT id, total FROM bookings ORDER BY id","target":"verify"},
		"assertions":[
			{"type":"rowCount","operator":"equals","target":"rowCount","expected":2},
			{"type":"valueEquals","operator":"equals","target":"row.total","expected":"250"},
			{"type":"valueEquals","operator":"equals","target":"rows[1].total","expected":"400"}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps[0].Checks)
	}
	if res.Steps[0].RowsAffected != 2 {
		t.Errorf("rows = %d, want 2", res.Steps[0].RowsAffected)
	}
}

// And the failure it exists to catch: nothing was written, and the step says so
// instead of passing on a row count Exec reported as zero for a different reason.
func TestSQLVerifyStepFailsWhenNothingWasWritten(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE bookings (id INTEGER, transaction_id INTEGER)`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"SELECT id FROM bookings WHERE transaction_id = 7","target":"verify"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowCount","expected":1}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunFailed {
		t.Fatalf("status = %s, want failed", res.Status)
	}
}

// A setup step executes, so its number is rows it moved, and the next step can
// read what it wrote -- a fixture in a rolled-back transaction would be invisible
// to the request that needs it.
func TestSQLSetupStepReportsRowsItMoved(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE guests (id INTEGER, email TEXT)`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"INSERT INTO guests VALUES (1, 'a@b.test'), (2, 'c@d.test')","target":"setup"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowsAffected","expected":2}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps[0].Checks)
	}
	if res.Steps[0].RowsAffected != 2 {
		t.Errorf("rows = %d, want 2", res.Steps[0].RowsAffected)
	}
}

// A row count says a row exists; the row says which one. The report carries both,
// or the dashboard can only ever show that a verification passed.
func TestSQLVerifyStepReportsTheRowsItRead(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE guests (id INTEGER, email TEXT, token TEXT)`)
	mustExec(t, db, `INSERT INTO guests VALUES (7, 'a@b.test', 'sk-live-secret')`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"SELECT id, email, token FROM guests","target":"verify"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowCount","expected":1}]}`)

	res, err := (&Engine{SandboxDB: db, Secrets: []string{"sk-live-secret"}}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	body := string(res.Steps[0].Body)
	for _, want := range []string{`"rowCount":1`, "a@b.test", `"id":7`} {
		if !strings.Contains(body, want) {
			t.Errorf("%s is not in the reported body: %s", want, body)
		}
	}
	if strings.Contains(body, "sk-live-secret") {
		t.Errorf("a secret reached the report: %s", body)
	}
}

// A setup step has no rows, and the number it reports is what the assertions read,
// so the two have to agree.
func TestSQLSetupStepReportsWhatItMovedAsItsBody(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE guests (id INTEGER)`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"INSERT INTO guests VALUES (1), (2)","target":"setup"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowsAffected","expected":2}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if body := string(res.Steps[0].Body); !strings.Contains(body, `"rowsAffected":2`) {
		t.Errorf("body = %s", body)
	}
}

// A fixture hands the real id to the request after it, which is what makes a
// setup step cheaper than three HTTP steps spent on a login.
func TestSQLStepExtractsForTheStepAfterIt(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE rooms (id INTEGER, code TEXT)`)
	mustExec(t, db, `INSERT INTO rooms VALUES (41, 'DLX')`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"SELECT id FROM rooms WHERE code = 'DLX'","target":"verify"},
		"extract":[{"name":"roomId","path":"row.id","source":"result"}],
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowCount","expected":1}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Vars["roomId"] != "41" {
		t.Errorf("roomId = %q, want 41", res.Vars["roomId"])
	}
}

// sqlite rather than MySQL, which the sandbox actually uses: what is under test
// here is the two branches and the shape they hand the assertions, and both are
// database/sql.
func memoryDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func mustExec(t *testing.T, db *sql.DB, stmt string) {
	t.Helper()
	if _, err := db.Exec(stmt); err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
}

// A name the config does not supply is still unbound, so a plan that reads one
// errors rather than sending an empty credential.
func TestEngineVariablesDoNotBindEverything(t *testing.T) {
	p := parse(t, `{"id":"s1","request":{"method":"GET","url":"/x/{{adminPassword}}"},
		"assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}`)

	res, err := (&Engine{BaseURL: "http://127.0.0.1:1", Variables: map[string]string{
		"adminEmail": "admin@hotel.test",
	}}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Steps[0].Status != StepError || !strings.Contains(res.Steps[0].Err, "adminPassword") {
		t.Fatalf("got %s %q", res.Steps[0].Status, res.Steps[0].Err)
	}
}

// The URL a step reports lands in cache.db and in the repairer's prompt, so a
// credential interpolated into a query string must not survive into it.
func TestEngineMasksASecretInTheReportedURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("pass") != "s3cret" {
			t.Errorf("the API must still receive the real value, got %q", r.URL.RawQuery)
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	p := &plan.Plan{
		Name: "sign in",
		Steps: []plan.Step{{
			ID: "s1",
			Request: plan.Request{Method: "GET", URL: "/login",
				Query: map[string]string{"pass": "{{adminPassword}}"}},
			Assertions: []plan.Assertion{
				{Type: plan.Status, Operator: plan.Equals, Target: "status", Expected: float64(200)},
			},
		}},
	}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}

	e := &Engine{
		BaseURL:   srv.URL,
		Variables: map[string]string{"adminPassword": "s3cret"},
		Secrets:   []string{"s3cret"},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	got := res.Steps[0].URL
	if strings.Contains(got, "s3cret") {
		t.Errorf("the secret reached the recorded run: %q", got)
	}
	if !strings.Contains(got, "pass=") {
		t.Errorf("masking should replace the value, not the URL: %q", got)
	}
}

// A response body goes the same three places a URL does, and an API that echoes
// what it was sent -- a validation error naming the bad password, a login handing
// back the user it just authenticated -- puts the credential in all three. So does
// an assertion whose expected value was interpolated from one.
func TestAnEchoedSecretDoesNotSurviveIntoTheReport(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(422)
		w.Write([]byte(`{"message":"s3cret is too short"}`))
	}))
	defer srv.Close()

	p := parse(t, `{"id":"s1","request":{"method":"POST","url":"/login",
		"body":{"password":"{{adminPassword}}"}},
		"assertions":[
			{"type":"bodyField","operator":"contains","target":"message","expected":"{{adminPassword}}"},
			{"type":"status","operator":"equals","target":"status","expected":422}]}`)

	e := &Engine{
		BaseURL:   srv.URL,
		Variables: map[string]string{"adminPassword": "s3cret"},
		Secrets:   []string{"s3cret"},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	step := res.Steps[0]
	if step.Status != StepPassed {
		t.Fatalf("the step did not run against the real value: %+v", step)
	}
	if strings.Contains(string(step.Body), "s3cret") {
		t.Errorf("the password survived into the response body: %s", step.Body)
	}
	if !strings.Contains(string(step.Body), "is too short") {
		t.Errorf("masking took more than the value: %s", step.Body)
	}
	for _, c := range step.Checks {
		if strings.Contains(c.Expected+c.Actual, "s3cret") {
			t.Errorf("the password survived into a check: %+v", c)
		}
	}
}

// A shell step's stdout travels to the dashboard and into a repair prompt, so a
// command that echoes a configured credential must not write it into either.
func TestShellStepMasksASecretInWhatItPrinted(t *testing.T) {
	p := parse(t, `{"id":"s1","kind":"shell","action":{"command":"printenv DB_PASSWORD"},
		"assertions":[{"type":"exitCode","operator":"equals","target":"exitCode","expected":0}]}`)

	e := &Engine{
		Secrets: []string{"s3cret"},
		ShellExec: func(ctx context.Context, cmd string) (string, string, int, error) {
			return "s3cret", "", 0, nil
		},
	}
	res, err := e.Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.Steps[0].Stdout, "s3cret") {
		t.Errorf("the password survived into stdout: %q", res.Steps[0].Stdout)
	}
}

// A statement is interpolated before it runs, and what it reports is the
// interpolated one -- masked, because a fixture can carry a credential too.
func TestSQLStepReportsTheStatementItRan(t *testing.T) {
	db := memoryDB(t)
	mustExec(t, db, `CREATE TABLE guests (id INTEGER, email TEXT)`)

	p := parse(t, `{"id":"s1","kind":"sql",
		"action":{"statement":"INSERT INTO guests VALUES (1, '{{email}}')","target":"setup"},
		"assertions":[{"type":"rowCount","operator":"equals","target":"rowsAffected","expected":1}]}`)

	res, err := (&Engine{SandboxDB: db}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Fatalf("status = %s: %+v", res.Status, res.Steps[0].Checks)
	}
	if !strings.Contains(res.Steps[0].URL, "qa@gritqa.dev") {
		t.Errorf("the reported statement is not the one that ran: %q", res.Steps[0].URL)
	}
}

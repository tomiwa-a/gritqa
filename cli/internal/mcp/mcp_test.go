package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
)

// stub is a Backend with no Docker and no project, which is the point of the
// interface: every handler is testable without either.
type stub struct {
	root     string
	compose  *sandbox.Compose
	status   StatusReport
	ran      string
	down     bool
}

func (s *stub) Index(context.Context) (*index.Snapshot, index.Delta, error) {
	return &index.Snapshot{
		Root:  s.root,
		Files: []index.File{{Path: "api/user.php", Language: "php", Size: 12}},
		Routes: []routes.Route{{Method: "GET", Path: "/users/:id", File: "api/user.php", Line: 9,
			Handler: "show", Middleware: []string{"auth"}}},
		Source: "ai",
	}, index.Delta{Changed: []string{"api/user.php"}}, nil
}

func (s *stub) Sandbox() *sandbox.Stack { return nil }

func (s *stub) StartSandbox(context.Context) (Boot, error) {
	return Boot{}, errNoDocker
}

func (s *stub) Compose(context.Context) (*sandbox.Compose, error) {
	if s.compose == nil {
		return nil, errors.New("no compose file found")
	}
	return s.compose, nil
}


func (s *stub) Status(context.Context) (StatusReport, error) { return s.status, nil }

func (s *stub) RunPlan(_ context.Context, p *plan.Plan) (*run.Result, error) {
	s.ran = p.Name
	return &run.Result{Plan: p.Name, Status: run.RunPassed}, nil
}

func (s *stub) TrialCall(_ context.Context, method, path string, _ map[string]string, _ map[string]string, _ map[string]any) (*run.StepResult, error) {
	return &run.StepResult{Method: method, URL: path, Code: 200}, nil
}

func (s *stub) Teardown(context.Context) error {
	s.down = true
	return nil
}

var errNoDocker = errStr("no docker in a unit test")

type errStr string

func (e errStr) Error() string { return string(e) }

// What the real backend renders for a human to paste. It is asserted here because
// a proposal recorded and never shown is a proposal nobody can approve.
func connect(t *testing.T, scope Scope) (*sdk.ClientSession, *stub) {
	t.Helper()
	root := t.TempDir()
	write(t, filepath.Join(root, "api", "user.php"), "<?php\n// findMe token\nfunction show() {}\n")

	back := &stub{root: root}
	srv, err := New(Options{Project: "p", Root: root, Backend: back,
		Variables: []string{"adminEmail", "adminPassword"}, Execute: scope == Execute})
	if err != nil {
		t.Fatal(err)
	}

	ct, st := sdk.NewInMemoryTransports()
	if _, err := srv.build(scope).Connect(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil).
		Connect(context.Background(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return cs, back
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

func names(t *testing.T, cs *sdk.ClientSession) []string {
	t.Helper()
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, tool := range res.Tools {
		out = append(out, tool.Name)
	}
	return out
}

// The whole security claim: a read client is not refused run_plan, it never
// learns it exists. A handler-side check would leave the capability in tools/list
// for a model to keep trying.
func TestAnExecuteToolIsNotAdvertisedToAReadClient(t *testing.T) {
	read, _ := connect(t, Read)
	got := names(t, read)

	for _, want := range []string{"get_index", "read_file", "search", "db", "start_sandbox",
		"teardown", "read_compose", "environment_status"} {
		if !has(got, want) {
			t.Errorf("a read client cannot reach %s: %v", want, got)
		}
	}
	for _, gone := range []string{"run_plan", "snapshot", "restore"} {
		if has(got, gone) {
			t.Errorf("%s is advertised at read scope", gone)
		}
	}

	// And calling one anyway is not a refusal with a hint ΓÇö the server has no such
	// tool at all.
	res, err := read.CallTool(context.Background(), &sdk.CallToolParams{
		Name: "run_plan", Arguments: map[string]any{"file": "x.json"}})
	if err == nil && !res.IsError {
		t.Fatal("a read client executed a plan")
	}

	exec, _ := connect(t, Execute)
	if got := names(t, exec); len(got) != len(surface) {
		t.Errorf("execute scope advertises %d of %d tools: %v", len(got), len(surface), got)
	}
}

func has(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func call[T any](t *testing.T, cs *sdk.ClientSession, name string, args map[string]any) T {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("%s failed: %s", name, text(res))
	}
	var out T
	body, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("%s returned %s: %v", name, body, err)
	}
	return out
}

func fails(t *testing.T, cs *sdk.ClientSession, name string, args map[string]any) string {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return err.Error()
	}
	if !res.IsError {
		t.Fatalf("%s(%v) was allowed", name, args)
	}
	return text(res)
}

func text(res *sdk.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*sdk.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

func TestGetIndexReportsWhatWasFoundAndWhatChanged(t *testing.T) {
	cs, _ := connect(t, Read)
	got := call[indexOut](t, cs, "get_index", nil)

	if got.Files != 1 || got.Languages["php"] != 1 {
		t.Errorf("files = %d, by language %v", got.Files, got.Languages)
	}
	if len(got.Endpoints) != 1 {
		t.Fatalf("endpoints = %v", got.Endpoints)
	}
	if e := got.Endpoints[0]; e.Path != "/users/:id" || e.File != "api/user.php" || !e.Guarded {
		t.Errorf("endpoint = %+v", e)
	}
	if len(got.Changed) != 1 || got.Changed[0] != "changed api/user.php" {
		t.Errorf("changed = %v", got.Changed)
	}
	// The names the developer configured, so a plan references their admin instead
	// of an invented one. Values stay behind: config resolves them at run time.
	if len(got.Variables) != 2 || got.Variables[1] != "adminPassword" {
		t.Errorf("plan_variables = %v", got.Variables)
	}
}

func TestReadFileStaysInTheProject(t *testing.T) {
	cs, _ := connect(t, Read)

	got := call[readOut](t, cs, "read_file", map[string]any{"path": "api/user.php"})
	if !strings.Contains(got.Content, "findMe token") {
		t.Errorf("content = %q", got.Content)
	}
	if got.Language != "php" || got.Truncated {
		t.Errorf("read %+v", got)
	}

	for _, bad := range []string{"../../etc/passwd", "/etc/passwd", "api/../../..", ""} {
		if msg := fails(t, cs, "read_file", map[string]any{"path": bad}); msg == "" {
			t.Errorf("%q was refused with no reason", bad)
		}
	}
}

// A symlink inside the project pointing out of it is the read that would slip past
// a string-prefix check.
func TestReadFileRefusesASymlinkOutOfTheProject(t *testing.T) {
	cs, back := connect(t, Read)
	outside := filepath.Join(t.TempDir(), "secret")
	write(t, outside, "not yours")
	if err := os.Symlink(outside, filepath.Join(back.root, "escape")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	if msg := fails(t, cs, "read_file", map[string]any{"path": "escape"}); !strings.Contains(msg, "outside") {
		t.Errorf("the symlink was refused with %q", msg)
	}
}

func TestSearchFindsLiteralsAndRegexps(t *testing.T) {
	cs, _ := connect(t, Read)

	got := call[searchOut](t, cs, "search", map[string]any{"query": "findMe"})
	if len(got.Matches) != 1 || got.Matches[0].Line != 2 || got.Matches[0].Path != "api/user.php" {
		t.Fatalf("matches = %+v", got.Matches)
	}

	if got := call[searchOut](t, cs, "search", map[string]any{"query": "FINDME"}); len(got.Matches) != 0 {
		t.Error("a literal search matched a different case")
	}
	if got := call[searchOut](t, cs, "search",
		map[string]any{"query": "FINDME", "ignore_case": true}); len(got.Matches) != 1 {
		t.Error("ignore_case did not")
	}
	if got := call[searchOut](t, cs, "search",
		map[string]any{"query": `func\w+ show`, "regex": true}); len(got.Matches) != 1 {
		t.Error("the regex found nothing")
	}
	if got := call[searchOut](t, cs, "search",
		map[string]any{"query": "findMe", "path": "nowhere"}); len(got.Matches) != 0 {
		t.Error("the path filter was ignored")
	}
	if msg := fails(t, cs, "search", map[string]any{"query": "([", "regex": true}); !strings.Contains(msg, "regular expression") {
		t.Errorf("a bad regex said %q", msg)
	}
	if got := call[searchOut](t, cs, "search",
		map[string]any{"query": "findMe", "max": 1}); len(got.Matches) != 1 {
		t.Error("max was ignored")
	}
}

// db is read-only by construction, and the reason is contamination rather than the
// user's data: research must not create the row a later run passes on.
func TestDBRefusesAnythingThatWrites(t *testing.T) {
	for _, sql := range []string{
		"INSERT INTO guests (email) VALUES ('x')",
		"UPDATE guests SET email = 'x'",
		"DELETE FROM guests",
		"DROP TABLE guests",
		"TRUNCATE guests",
		"GRANT ALL ON *.* TO x",
		"SELECT 1; DROP TABLE guests",
		"  ",
	} {
		if _, err := readOnly(sql); err == nil {
			t.Errorf("%q was allowed", sql)
		}
	}
	for _, sql := range []string{
		"SELECT * FROM guests",
		"select 1;",
		"SHOW TABLES",
		"EXPLAIN SELECT 1",
		"DESCRIBE guests",
		"WITH x AS (SELECT 1) SELECT * FROM x",
		"SELECT (1);",
	} {
		if _, err := readOnly(sql); err != nil {
			t.Errorf("%q was refused: %v", sql, err)
		}
	}
	if got, _ := readOnly(" SELECT 1 ; "); got != "SELECT 1" {
		t.Errorf("the trailing semicolon survived: %q", got)
	}

	// A CTE puts the write past a verb check ΓÇö `WITH x AS (...) DELETE FROM t` reads
	// as WITH. The READ ONLY transaction in db() is what actually refuses it, and
	// only OUTFILE, which writes outside the transaction, is caught here.
	for _, sql := range []string{
		"SELECT * FROM guests INTO OUTFILE '/tmp/leak.csv'",
		"SELECT * FROM guests INTO DUMPFILE '/tmp/leak'",
	} {
		if _, err := readOnly(sql); err == nil {
			t.Errorf("%q was allowed", sql)
		}
	}
	if err := wrote(&mysql.MySQLError{Number: mysqlReadOnly, Message: "Cannot execute statement"}); err == nil ||
		!strings.Contains(err.Error(), "review") {
		t.Errorf("a refused write reads as %v", err)
	}
	if err := wrote(errors.New("boom")); err == nil || err.Error() != "boom" {
		t.Errorf("an unrelated error was rewritten to %v", err)
	}
}

// The declaration reaches the agent whole and unread: a profiled service arrives
// labelled rather than filtered, an interpolated value arrives as its expression,
// and the note points at the next read instead of at a conclusion.
func TestReadComposeHandsOverWhatTheFileDeclares(t *testing.T) {
	cs, back := connect(t, Read)

	if msg := fails(t, cs, "read_compose", nil); !strings.Contains(msg, "compose") {
		t.Errorf("a project with no compose file said %q", msg)
	}

	back.compose = &sandbox.Compose{
		Name:        "shop",
		Files:       []string{filepath.Join(back.root, "compose.yml")},
		Fingerprint: "9f2c",
		Services: []sandbox.Service{
			{Name: "api", Build: back.root,
				Ports: []sandbox.Port{{Container: 3000, Published: "3000", Protocol: "tcp"}}},
			{Name: "store", Image: "postgres:16",
				Environment: map[string]string{"POSTGRES_PASSWORD": "${PW}"}},
			{Name: "migrate", Image: "postgres:16", Profiles: []string{"tools"}},
		},
	}

	got := call[composeOut](t, cs, "read_compose", nil)
	if got.Compose == nil || got.Compose.Name != "shop" || len(got.Compose.Services) != 3 {
		t.Fatalf("got %+v", got.Compose)
	}
	if !got.Compose.Services[2].Gated() {
		t.Error("a service behind a profile has to arrive labelled, not dropped")
	}
	if got.Compose.Services[1].Environment["POSTGRES_PASSWORD"] != "${PW}" {
		t.Errorf("environment = %v", got.Compose.Services[1].Environment)
	}
	if !strings.Contains(got.Note, "3 services") {
		t.Errorf("note = %q", got.Note)
	}
}

// A fixture project GritQA has no built-in opinion about: two services it could
// not tell apart by name, one of them holding the data.
func fixture(root string) *sandbox.Compose {
	return &sandbox.Compose{
		Name:        "shop",
		Files:       []string{filepath.Join(root, "compose.yml")},
		Fingerprint: "9f2c",
		Services: []sandbox.Service{
			{Name: "cache", Image: "redis:7"},
			{Name: "store", Image: "postgres:16",
				Environment: map[string]string{"POSTGRES_PASSWORD": "${PW}", "POSTGRES_DB": "shop"}},
			{Name: "web", Build: root, Ports: []sandbox.Port{{Container: 3000, Published: "3000"}}},
		},
	}
}

// Reading says plainly that nothing is known, because nothing is: the whole point
// of the seam is that GritQA stopped answering this for itself.

// environment_status is read-only: it reports what is configured, never records
// anything. An unconfigured project names the fix; a configured one names the
// verdicts and whether a run could boot.
func TestEnvironmentStatusNamesTheFixWhenUnconfigured(t *testing.T) {
	cs, back := connect(t, Read)
	back.status = StatusReport{Configured: false, Reason: "no service verdicts"}

	got := call[StatusReport](t, cs, "environment_status", nil)
	if got.Configured || got.Reason == "" {
		t.Errorf("unconfigured status reads %+v, want it to say what is missing", got)
	}
}

func TestEnvironmentStatusReportsVerdictsAndBootability(t *testing.T) {
	cs, back := connect(t, Read)
	back.status = StatusReport{
		Configured: true,
		Services:   []ServiceStatus{{Name: "web", Role: "tested"}, {Name: "db", Role: "support"}},
		Bootable:   true,
		Reason:     "configured",
	}

	got := call[StatusReport](t, cs, "environment_status", nil)
	if !got.Configured || !got.Bootable {
		t.Errorf("configured status reads %+v", got)
	}
	if len(got.Services) != 2 || got.Services[0].Name != "web" {
		t.Errorf("services read %+v", got.Services)
	}
}
func TestExecuteToolsReachTheBackend(t *testing.T) {
	cs, back := connect(t, Execute)
	write(t, filepath.Join(back.root, "p.json"), `{"name":"a plan","steps":[
	  {"id":"list","name":"list","request":{"method":"GET","url":"/users"},"assertions":[{"type":"status","operator":"equals","expected":200}]}]}`)

	got := call[runOut](t, cs, "run_plan", map[string]any{"file": "p.json"})
	if got.Plan != "a plan" || got.Status != string(run.RunPassed) {
		t.Errorf("run = %+v", got)
	}
	if back.ran != "a plan" {
		t.Errorf("the backend ran %q", back.ran)
	}
	if msg := fails(t, cs, "run_plan", map[string]any{"file": "../outside.json"}); !strings.Contains(msg, "outside") {
		t.Errorf("a plan above the project said %q", msg)
	}

	if _, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: "teardown"}); err != nil {
		t.Fatal(err)
	}
	if !back.down {
		t.Error("teardown did not reach the backend")
	}
}

// A tool that needs Docker has to fail as a tool error the model can read, not as
// a protocol error that drops the session.
func TestASandboxFailureIsAToolError(t *testing.T) {
	cs, _ := connect(t, Read)
	if msg := fails(t, cs, "start_sandbox", nil); !strings.Contains(msg, "docker") {
		t.Errorf("the failure said %q", msg)
	}
	// And a query does not bring one up on its own — it says what would.
	if msg := fails(t, cs, "db", map[string]any{"sql": "SELECT 1"}); !strings.Contains(msg, "start_sandbox") {
		t.Errorf("db without a sandbox said %q", msg)
	}
	if names(t, cs) == nil {
		t.Error("the session did not survive a failed tool call")
	}
}

func TestTokensAreScopedAndConstantTimeChecked(t *testing.T) {
	k, err := newKeyring(Read, Execute)
	if err != nil {
		t.Fatal(err)
	}
	if k.tokens[Read] == k.tokens[Execute] {
		t.Fatal("both scopes got one token")
	}
	for scope, token := range k.tokens {
		if len(token) < 24 {
			t.Errorf("the %s token is %d characters", scope, len(token))
		}
		r := &http.Request{Header: http.Header{"Authorization": {"Bearer " + token}}}
		if got, ok := k.scope(r); !ok || got != scope {
			t.Errorf("%s token resolved to %q, %v", scope, got, ok)
		}
	}
	for _, header := range []string{"", "Bearer ", "Bearer wrong", k.tokens[Read]} {
		r := &http.Request{Header: http.Header{"Authorization": {header}}}
		if _, ok := k.scope(r); ok {
			t.Errorf("%q was accepted", header)
		}
	}
}

// Scope-by-construction picks the tools when a session opens; every request after
// that routes by session id. Without this check a read bearer could present the
// execute session's id and reach an execute tool — which it could, and did.
func TestAnExecuteSessionCannotBeBorrowedByAReadBearer(t *testing.T) {
	srv, err := New(Options{Project: "p", Root: t.TempDir(), Backend: &stub{}, Execute: true})
	if err != nil {
		t.Fatal(err)
	}
	reached := false
	h := srv.authorize(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))

	try := func(scope Scope, sid string) int {
		reached = false
		r := httptest.NewRequest("POST", "/", nil)
		if scope != "" {
			r.Header.Set("Authorization", "Bearer "+srv.keys.tokens[scope])
		}
		if sid != "" {
			r.Header.Set("Mcp-Session-Id", sid)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if (w.Code == http.StatusOK) != reached {
			t.Fatalf("%s/%s answered %d but reached=%v", scope, sid, w.Code, reached)
		}
		return w.Code
	}

	readSID, execSID := session(Read), session(Execute)
	if !sessionMatches(readSID, Read) || sessionMatches(readSID, Execute) {
		t.Fatalf("a read session id is %q", readSID)
	}
	for _, c := range []struct {
		what  string
		scope Scope
		sid   string
		want  int
	}{
		{"no bearer", "", "", http.StatusUnauthorized},
		{"read, its own session", Read, readSID, http.StatusOK},
		{"read, no session yet", Read, "", http.StatusOK},
		{"read, the execute session", Read, execSID, http.StatusForbidden},
		{"execute, its own session", Execute, execSID, http.StatusOK},
		{"execute, the read session", Execute, readSID, http.StatusForbidden},
		{"read, a session nobody minted", Read, "execute-invented", http.StatusForbidden},
		{"read, a session with no scope", Read, "invented", http.StatusForbidden},
	} {
		if got := try(c.scope, c.sid); got != c.want {
			t.Errorf("%s: %d, want %d", c.what, got, c.want)
		}
	}

	// The scope is in the id, the secret is not.
	if strings.Contains(readSID, srv.keys.tokens[Read]) {
		t.Error("the session id carries the bearer")
	}
}

func TestScopeIsASupersetNotASibling(t *testing.T) {
	if !Execute.allows(Read) || !Execute.allows(Execute) {
		t.Error("an orchestrator has to research as well as run")
	}
	if Read.allows(Execute) {
		t.Error("read reached an execute tool")
	}
}

func TestTheListenerIsThisMachineOnly(t *testing.T) {
	for _, addr := range []string{"7391", ":7391", "127.0.0.1:7391", "localhost:7391", "[::1]:7391"} {
		if _, err := loopback(addr); err != nil {
			t.Errorf("%s was refused: %v", addr, err)
		}
	}
	for _, addr := range []string{"0.0.0.0:7391", "192.168.1.20:7391", "example.com:7391"} {
		if _, err := loopback(addr); err == nil {
			t.Errorf("%s was accepted", addr)
		}
	}
	if got, _ := loopback("7391"); got != "127.0.0.1:7391" {
		t.Errorf("a bare port became %q", got)
	}
}

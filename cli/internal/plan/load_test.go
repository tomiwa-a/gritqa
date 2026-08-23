package plan

import (
	"strings"
	"testing"
)

// step is the smallest thing that validates, so each case below changes one
// thing and the failure names that thing.
func step(id string, deps ...string) string {
	on := `[]`
	if len(deps) > 0 {
		on = `["` + strings.Join(deps, `","`) + `"]`
	}
	return `{"id":"` + id + `","name":"` + id + `","description":"","dependsOn":` + on + `,
		"request":{"method":"GET","url":"/x"},"extract":[],
		"assertions":[{"type":"status","operator":"equals","target":"status","expected":200}],
		"onFailure":"abort"}`
}

func wrap(steps ...string) []byte {
	return []byte(`{"name":"p","version":1,"description":"","baseUrl":"http://x",
		"variables":{},"steps":[` + strings.Join(steps, ",") + `]}`)
}

func TestOrderKeepsDeclarationOrder(t *testing.T) {
	p, err := Parse(wrap(step("a"), step("b"), step("c", "b")))
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Order()
	if err != nil {
		t.Fatal(err)
	}
	if ids(got) != "a b c" {
		t.Fatalf("order = %s, want a b c", ids(got))
	}
}

func TestOrderPromotesDependencies(t *testing.T) {
	p, err := Parse(wrap(step("c", "b"), step("b", "a"), step("a")))
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Order()
	if err != nil {
		t.Fatal(err)
	}
	if ids(got) != "a b c" {
		t.Fatalf("order = %s, want a b c", ids(got))
	}
}

func TestValidateRejects(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		says string
	}{
		{"a cycle", wrap(step("a", "b"), step("b", "a")), "circle"},
		{"a longer cycle", wrap(step("a", "c"), step("b", "a"), step("c", "b")), "circle"},
		{"a dependency on itself", wrap(step("a", "a")), "itself"},
		{"a dependency on nothing", wrap(step("a", "ghost")), "not in the plan"},
		{"two steps sharing an id", wrap(step("a"), step("a")), "share the id"},
		{"no steps", []byte(`{"name":"p","version":1,"steps":[]}`), "no steps"},
		{"no name", []byte(`{"version":1,"steps":[` + step("a") + `]}`), "no name"},
		{"nothing at all", []byte(``), "not a plan I recognise"},
		{
			"an unknown assertion type",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"assertions":[{"type":"cookie","operator":"equals","target":"t","expected":1}]}`),
			"not a thing I can check",
		},
		{
			"an unknown operator",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"assertions":[{"type":"status","operator":"between","target":"status","expected":1}]}`),
			"operator",
		},
		{
			"an assertion with nothing to compare against",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"assertions":[{"type":"bodyField","operator":"equals","target":"data.id"}]}`),
			"nothing to compare against",
		},
		{
			"a bodyField assertion with no target",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"assertions":[{"type":"bodyField","operator":"exists","target":""}]}`),
			"no target",
		},
		{
			"a method it cannot send",
			wrap(`{"id":"a","request":{"method":"TRACE","url":"/x"}}`),
			"cannot send",
		},
		{"no url", wrap(`{"id":"a","request":{"method":"GET","url":""}}`), "no url"},
		{
			"an extraction from somewhere else",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"extract":[{"name":"t","path":"$.t","source":"cookie"}]}`),
			"not a recognised source",
		},
		{
			"an onFailure it does not know",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},"onFailure":"retry"}`),
			"neither abort nor continue",
		},
		{
			"a retry with no attempts",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},"retry":{"maxAttempts":0}}`),
			"0 attempts",
		},
		{
			"a field nobody wrote",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},"timeout":30}`),
			"not a plan I recognise",
		},
		// SQL step validation.
		{
			"sql step with no action",
			wrap(`{"id":"a","kind":"sql"}`),
			"sql step with no action",
		},
		{
			"sql step with no statement",
			wrap(`{"id":"a","kind":"sql","action":{"target":"setup"}}`),
			"has no statement",
		},
		{
			"sql step with bad target",
			wrap(`{"id":"a","kind":"sql","action":{"statement":"SELECT 1","target":"write"}}`),
			"neither setup nor verify",
		},
		// Shell step validation.
		{
			"shell step with no action",
			wrap(`{"id":"a","kind":"shell"}`),
			"shell step with no action",
		},
		{
			"shell step with no command",
			wrap(`{"id":"a","kind":"shell","action":{}}`),
			"has no command",
		},
		{
			"unknown step kind",
			wrap(`{"id":"a","kind":"grpc","request":{"method":"GET","url":"/x"}}`),
			"not one of http, sql, shell",
		},
		// New assertion types. rowCount, exitCode and stdoutContains are absent on
		// purpose: each names its own channel, so none of them needs telling.
		{
			"valueEquals with no target",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"assertions":[{"type":"valueEquals","operator":"equals","target":"","expected":1}]}`),
			"no target",
		},
		// New extraction sources.
		{
			"extraction from result without path",
			wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
				"extract":[{"name":"t","path":"","source":"result"}]}`),
			"from no path",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Parse(c.raw)
			if err == nil {
				t.Fatal("this should not have validated")
			}
			if !strings.Contains(err.Error(), c.says) {
				t.Fatalf("err = %q, want it to mention %q", err, c.says)
			}
		})
	}
}

// The types that name their own channel load without one, so a plan does not have
// to repeat "rowCount" twice to say it once.
func TestValidateAcceptsASelfNamingAssertionWithNoTarget(t *testing.T) {
	for _, a := range []string{
		`{"type":"rowCount","operator":"equals","expected":1}`,
		`{"type":"exitCode","operator":"equals","expected":0}`,
		`{"type":"stdoutContains","operator":"contains","expected":"done"}`,
	} {
		if _, err := Parse(wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
			"assertions":[` + a + `]}`)); err != nil {
			t.Errorf("%s: %v", a, err)
		}
	}
}

func TestValidateNormalises(t *testing.T) {
	p, err := Parse(wrap(`{"id":"a","request":{"method":"get","url":"/x"}}`))
	if err != nil {
		t.Fatal(err)
	}
	s := p.Steps[0]

	if s.Request.Method != "GET" {
		t.Errorf("method = %q", s.Request.Method)
	}
	// A hand-written plan leaving onFailure out means the safe thing.
	if s.OnFailure != Abort {
		t.Errorf("onFailure = %q, want abort", s.OnFailure)
	}
	if s.DependsOn == nil || s.Extract == nil || s.Assertions == nil || p.Variables == nil {
		t.Error("empty, not null, so a plan written back keeps the dashboard's shape")
	}
	if a, d := s.Attempts(); a != 1 || d != 0 {
		t.Errorf("no retry block = %d attempts, %dms", a, d)
	}
}

// maxAttempts counts total attempts, so 1 has to mean one.
func TestAttemptsCountTotal(t *testing.T) {
	p, err := Parse(wrap(`{"id":"a","request":{"method":"GET","url":"/x"},
		"retry":{"maxAttempts":1,"delayMs":0}}`))
	if err != nil {
		t.Fatal(err)
	}
	if a, _ := p.Steps[0].Attempts(); a != 1 {
		t.Fatalf("attempts = %d, want 1", a)
	}
}

func ids(steps []Step) string {
	out := make([]string, len(steps))
	for i, s := range steps {
		out[i] = s.ID
	}
	return strings.Join(out, " ")
}

// Two independently drafted plans both reached for a template function the
// format does not have. The interpolator leaves them alone, so a check_in date
// of "{{strftime ...}}" reaches the API as written and proves nothing.
func TestValidateRejectsBracesThatAreNotAVariable(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"a seeded template call", `{"variables":{"checkIn":"{{strftime \"%Y-%m-%d\" \"+1 day\"}}"},
			"name":"p","steps":[{"id":"s1","request":{"method":"GET","url":"/x"},
			"assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}]}`},
		{"a name with a space in it", `{"name":"p","steps":[{"id":"s1",
			"request":{"method":"GET","url":"/x","query":{"name":"{{roomTypeName Updated}}"}},
			"assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}]}`},
		{"inside a body", `{"name":"p","steps":[{"id":"s1",
			"request":{"method":"POST","url":"/x","body":{"rooms":[{"n":"{{randomInt 1 9}}"}]}},
			"assertions":[{"type":"status","operator":"equals","target":"status","expected":200}]}]}`},
		{"inside an expected value", `{"name":"p","steps":[{"id":"s1",
			"request":{"method":"GET","url":"/x"},
			"assertions":[{"type":"bodyField","operator":"equals","target":"a","expected":"{{a b}}"}]}]}`},
	} {
		if _, err := Parse([]byte(tc.body)); err == nil {
			t.Errorf("%s should not have validated", tc.name)
		}
	}
}

// And the reference that does work is untouched.
func TestValidateKeepsARealReference(t *testing.T) {
	body := `{"variables":{"email":"qa@example.com"},"name":"p","steps":[{"id":"s1",
		"request":{"method":"POST","url":"/x/{{ id }}","headers":{"A":"Bearer {{token}}"},
		"body":{"email":"{{email}}"}},
		"assertions":[{"type":"bodyField","operator":"equals","target":"a","expected":"{{taxTotal}}"}]}]}`
	if _, err := Parse([]byte(body)); err != nil {
		t.Fatal(err)
	}
}

// M7d: SQL and shell step parsing.

func TestParseSQLStep(t *testing.T) {
	raw := []byte(`{"name":"db setup","version":1,"description":"","baseUrl":"",
		"variables":{},"steps":[{"id":"s1","kind":"sql","name":"seed users",
		"action":{"statement":"INSERT INTO users (name) VALUES ('qa')","target":"setup"},
		"dependsOn":[],"extract":[],"assertions":[],"onFailure":"abort"}]}`)
	p, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	s := p.Steps[0]
	if s.Kind != SQLStep {
		t.Errorf("kind = %q, want sql", s.Kind)
	}
	if s.Action == nil || s.Action.Statement != "INSERT INTO users (name) VALUES ('qa')" {
		t.Errorf("statement = %v", s.Action)
	}
	if s.Action.Target != "setup" {
		t.Errorf("target = %q, want setup", s.Action.Target)
	}
}

func TestParseShellStep(t *testing.T) {
	raw := []byte(`{"name":"migration","version":1,"description":"","baseUrl":"",
		"variables":{},"steps":[{"id":"s1","kind":"shell","name":"run migrations",
		"action":{"command":"npm run migrate"},
		"dependsOn":[],"extract":[],"assertions":[],"onFailure":"abort"}]}`)
	p, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	s := p.Steps[0]
	if s.Kind != ShellStep {
		t.Errorf("kind = %q, want shell", s.Kind)
	}
	if s.Action == nil || s.Action.Command != "npm run migrate" {
		t.Errorf("command = %v", s.Action)
	}
}

func TestSQLStepLabel(t *testing.T) {
	s := Step{Kind: SQLStep, Action: &Action{Statement: "SELECT count(*) FROM users"}}
	if got := s.Label(); got != "SQL SELECT count(*) FROM users" {
		t.Errorf("Label() = %q", got)
	}
}

func TestShellStepLabel(t *testing.T) {
	s := Step{Kind: ShellStep, Action: &Action{Command: "npm test"}}
	if got := s.Label(); got != "shell npm test" {
		t.Errorf("Label() = %q", got)
	}
}

func TestEndpointsSkipsNonHTTPSteps(t *testing.T) {
	raw := []byte(`{"name":"p","version":1,"description":"","baseUrl":"http://x",
		"variables":{},"steps":[
		{"id":"s1","kind":"sql","action":{"statement":"SELECT 1"},"dependsOn":[],
			"extract":[],"assertions":[],"onFailure":"abort"},
		{"id":"s2","kind":"shell","action":{"command":"echo hi"},"dependsOn":[],
			"extract":[],"assertions":[],"onFailure":"abort"},
		{"id":"s3","request":{"method":"GET","url":"/api/users"},"dependsOn":[],
			"extract":[],"assertions":[],"onFailure":"abort"}
		]}`)
	p, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	eps := p.Endpoints()
	if len(eps) != 1 || eps[0] != "GET /api/users" {
		t.Errorf("Endpoints() = %v, want [GET /api/users]", eps)
	}
}

func TestBackwardCompatMissingKindDefaultsToHTTP(t *testing.T) {
	raw := []byte(`{"name":"p","version":1,"description":"","baseUrl":"",
		"variables":{},"steps":[{"id":"s1","request":{"method":"GET","url":"/x"},
		"dependsOn":[],"extract":[],"assertions":[],"onFailure":"abort"}]}`)
	p, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if p.Steps[0].Kind != "" {
		t.Errorf("Kind = %q, want empty (defaults at execution time)", p.Steps[0].Kind)
	}
}

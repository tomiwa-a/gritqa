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
			"neither body nor header",
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

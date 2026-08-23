package run

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		name     string
		op       plan.Operator
		actual   any
		found    bool
		expected any
		want     bool
		wantErr  bool
	}{
		// The loop that closes extract → interpolate → compare.
		{"number equals string", plan.Equals, float64(66750), true, "66750", true, false},
		{"string equals number", plan.Equals, "66750", true, float64(66750), true, false},
		{"status equals", plan.Equals, 201, true, float64(201), true, false},
		{"status differs", plan.Equals, 401, true, float64(200), false, false},
		{"float keeps precision", plan.Equals, float64(1.5), true, "1.5", true, false},
		{"bool equals", plan.Equals, true, true, true, true, false},
		{"equals a missing field fails", plan.Equals, nil, false, "x", false, false},

		{"notEquals holds", plan.NotEquals, "a", true, "b", true, false},
		{"notEquals rejects a match", plan.NotEquals, "a", true, "a", false, false},
		{"notEquals passes when absent", plan.NotEquals, nil, false, "a", true, false},

		{"contains", plan.Contains, "application/json; charset=utf-8", true, "application/json", true, false},
		{"contains rejects", plan.Contains, "text/html", true, "json", false, false},
		{"contains a missing field fails", plan.Contains, nil, false, "json", false, false},
		{"notContains", plan.NotContains, "text/html", true, "json", true, false},
		{"notContains rejects", plan.NotContains, "application/json", true, "json", false, false},
		{"notContains passes when absent", plan.NotContains, nil, false, "json", true, false},

		{"exists", plan.Exists, "u_1", true, nil, true, false},
		{"exists rejects absent", plan.Exists, nil, false, nil, false, false},
		{"exists rejects null", plan.Exists, nil, true, nil, false, false},

		{"lt", plan.LT, float64(120), true, float64(500), true, false},
		{"lt rejects", plan.LT, float64(900), true, float64(500), false, false},
		{"lt reads a string number", plan.LT, "120", true, float64(500), true, false},
		{"gt", plan.GT, int64(900), true, float64(500), true, false},
		{"gt rejects", plan.GT, int64(100), true, float64(500), false, false},
		{"lt on words is an error", plan.LT, "soon", true, float64(500), false, true},
		{"lt against words is an error", plan.LT, float64(1), true, "soon", false, true},
		{"lt with nothing there is an error", plan.LT, nil, false, float64(500), false, true},

		{"an unknown operator is an error", plan.Operator("between"), 1, true, 2, false, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := compare(c.op, c.actual, c.found, c.expected)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, want error: %v", err, c.wantErr)
			}
			if err == nil && got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestAssertInterpolatesExpected(t *testing.T) {
	res := response(t, 200, `{"data":{"tax_total":66750}}`)

	checks, err := Assert([]plan.Assertion{{
		Type:     plan.BodyField,
		Operator: plan.Equals,
		Target:   "data.tax_total",
		Expected: "{{taxTotal}}",
	}}, res, map[string]string{"taxTotal": "66750"})
	if err != nil {
		t.Fatal(err)
	}
	if !checks[0].Passed {
		t.Fatalf("expected %q to equal actual %q", checks[0].Expected, checks[0].Actual)
	}
}

func TestAssertReportsRawTerms(t *testing.T) {
	res := response(t, 401, `{"error":"no session"}`)

	checks, err := Assert([]plan.Assertion{{
		Type: plan.Status, Operator: plan.Equals, Expected: float64(200),
	}}, res, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := checks[0]
	if c.Passed || c.Expected != "200" || c.Actual != "401" || c.Operator != plan.Equals {
		t.Fatalf("got %+v", c)
	}
}

func TestAssertNonJSONBodyIsAnError(t *testing.T) {
	res := response(t, 200, `<html>up</html>`)

	_, err := Assert([]plan.Assertion{{
		Type: plan.BodyField, Operator: plan.Exists, Target: "data.id",
	}}, res, nil)
	if err == nil || !strings.Contains(err.Error(), "not JSON") {
		t.Fatalf("err = %v", err)
	}
}

func TestAssertHeaderAndResponseTime(t *testing.T) {
	res := response(t, 200, `{}`)
	res.Headers.Set("Content-Type", "application/json")
	res.Elapsed = 120 * time.Millisecond

	checks, err := Assert([]plan.Assertion{
		{Type: plan.HeaderField, Operator: plan.Contains, Target: "content-type", Expected: "json"},
		{Type: plan.HeaderField, Operator: plan.Exists, Target: "X-Request-Id"},
		{Type: plan.ResponseTime, Operator: plan.LT, Expected: float64(500)},
	}, res, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !checks[0].Passed {
		t.Error("header lookup should be case-insensitive")
	}
	if checks[1].Passed {
		t.Error("a header that is not there does not exist")
	}
	if !checks[2].Passed {
		t.Error("120ms is under 500ms")
	}
}

func response(t *testing.T, code int, body string) *Response {
	t.Helper()
	res := &Response{Status: code, Headers: http.Header{}, Body: []byte(body)}
	if err := decodeInto(&res.JSON, body); err != nil {
		res.JSON = nil
	}
	return res
}

// The other half of what repair freezes. The type is frozen and the target is not,
// so a type that read through the target would leave the freeze worth nothing: a
// command exiting 1 with no output has lineCount 0 sitting in the same synthetic
// JSON, and pointing an `exitCode equals 0` at it would go green. It reads exitCode
// wherever it is pointed, and the check says so rather than repeating the redirect.
func TestAssertTypedChannelsIgnoreTheTarget(t *testing.T) {
	shell := &Response{Status: 200, JSON: map[string]any{
		"exitCode": 1, "stdout": "", "stderr": "boom", "lineCount": 0,
	}}

	cases := []struct {
		what string
		a    plan.Assertion
	}{
		{"exitCode redirected at lineCount",
			plan.Assertion{Type: plan.ExitCode, Operator: plan.Equals, Target: "lineCount", Expected: float64(0)}},
		{"stdoutContains redirected at stderr",
			plan.Assertion{Type: plan.StdoutContains, Operator: plan.Contains, Target: "stderr", Expected: "boom"}},
	}

	for _, c := range cases {
		checks, err := Assert([]plan.Assertion{c.a}, shell, nil)
		if err != nil {
			t.Fatalf("%s: %v", c.what, err)
		}
		if checks[0].Passed {
			t.Errorf("%s passed, so the target still decides what is read", c.what)
		}
		if want := channels[c.a.Type]; checks[0].Target != want {
			t.Errorf("%s reported target %q, not the %q it read", c.what, checks[0].Target, want)
		}
	}
}

// And the same rule the other way: a rowCount written the way the wire format
// documents it -- target "rows" -- reads the count and passes on a real row.
func TestAssertRowCountReadsTheCountWhateverTheTargetSays(t *testing.T) {
	res := &Response{Status: 200, JSON: map[string]any{
		"rowCount": int64(1), "rows": []any{map[string]any{"n": "1"}},
	}}
	for _, target := range []string{"", "rows", "rowCount"} {
		checks, err := Assert([]plan.Assertion{{
			Type: plan.RowCount, Operator: plan.Equals, Target: target, Expected: float64(1),
		}}, res, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !checks[0].Passed {
			t.Errorf("target %q: one row should satisfy rowCount 1, got %q", target, checks[0].Actual)
		}
		if checks[0].Target != "rowCount" {
			t.Errorf("target %q was reported as %q rather than what it read", target, checks[0].Target)
		}
	}
}

package run

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

// Check is one assertion's outcome. The wording belongs to whoever renders it,
// so this carries the plan's own terms and nothing prettier.
type Check struct {
	Type     plan.AssertionType
	Operator plan.Operator
	Target   string
	Passed   bool
	Found    bool
	Expected string
	Actual   string
}

// Assert evaluates a step's assertions against the response. It returns an
// error only when the response cannot answer the question at all — that is a
// step that never really asserted, not a step that failed.
func Assert(as []plan.Assertion, res *Response, vars map[string]string) ([]Check, error) {
	checks := make([]Check, 0, len(as))

	for _, a := range as {
		if a.Type == plan.BodyField && res.JSON == nil {
			return checks, fmt.Errorf("the response is not JSON, so %s cannot be read", a.Target)
		}

		expected, err := Deep(a.Expected, vars)
		if err != nil {
			return checks, fmt.Errorf("%s: %w", a.Target, err)
		}

		actual, found := actualOf(a, res)
		passed, err := compare(a.Operator, actual, found, expected)
		if err != nil {
			return checks, fmt.Errorf("%s: %w", a.Target, err)
		}

		checks = append(checks, Check{
			Type:     a.Type,
			Operator: a.Operator,
			Target:   readAt(a),
			Passed:   passed,
			Found:    found,
			Expected: normalise(expected),
			Actual:   normalise(actual),
		})
	}
	return checks, nil
}

func allPassed(checks []Check) bool {
	for _, c := range checks {
		if !c.Passed {
			return false
		}
	}
	return true
}

// channels are the assertion types that name what they read. Repair freezes the
// type and not the target, so a type reading through the target pins nothing: an
// exitCode assertion redirected at lineCount still reports as exitCode, and a
// command that exits 1 printing nothing then satisfies `exitCode equals 0`. Where
// the name says the channel, the name decides it.
//
// bodyField, header and valueEquals stay free, because "which field" is the
// mechanical detail decision 15 lets a fix correct.
var channels = map[plan.AssertionType]string{
	plan.ExitCode:       "exitCode",
	plan.RowCount:       "rowCount",
	plan.StdoutContains: "stdout",
}

// readAt is the path an assertion actually reads. Reported on the Check as well as
// used for the lookup, so nothing can say one and mean the other.
func readAt(a plan.Assertion) string {
	if c, ok := channels[a.Type]; ok {
		return c
	}
	return a.Target
}

func actualOf(a plan.Assertion, res *Response) (any, bool) {
	switch a.Type {
	case plan.Status:
		return res.Status, true
	case plan.ResponseTime:
		return res.Elapsed.Milliseconds(), true
	case plan.HeaderField:
		v := res.Headers.Get(a.Target)
		return v, v != ""
	}
	return Value(res.JSON, readAt(a))
}

// compare is the only place two values meet. Everything scalar is normalised to
// a string first, because a value extracted as the number 66750 travels through
// a variable as text and has to come back equal.
func compare(op plan.Operator, actual any, found bool, expected any) (bool, error) {
	switch op {
	case plan.Exists:
		return found && actual != nil, nil
	case plan.Equals:
		return found && normalise(actual) == normalise(expected), nil
	case plan.NotEquals:
		return !found || normalise(actual) != normalise(expected), nil
	case plan.Contains:
		return found && strings.Contains(normalise(actual), normalise(expected)), nil
	case plan.NotContains:
		return !found || !strings.Contains(normalise(actual), normalise(expected)), nil
	case plan.LT, plan.GT:
		a, err := number(actual, found)
		if err != nil {
			return false, err
		}
		e, err := number(expected, true)
		if err != nil {
			return false, err
		}
		if op == plan.LT {
			return a < e, nil
		}
		return a > e, nil
	}
	return false, fmt.Errorf("I do not know the operator %q", op)
}

func number(v any, found bool) (float64, error) {
	if !found {
		return 0, fmt.Errorf("there is no value here to compare")
	}
	switch t := v.(type) {
	case float64:
		return t, nil
	case int:
		return float64(t), nil
	case int64:
		return float64(t), nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		if err != nil {
			return 0, fmt.Errorf("%q is not a number to compare against", t)
		}
		return f, nil
	}
	return 0, fmt.Errorf("%s is not a number to compare against", normalise(v))
}

func normalise(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case json.Number:
		return t.String()
	case []any, map[string]any:
		b, err := json.Marshal(t)
		if err != nil {
			return fmt.Sprint(t)
		}
		return string(b)
	}
	return fmt.Sprint(v)
}

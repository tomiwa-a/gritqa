package agent

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/gritqa/cli/internal/plan"
)

// Change is one edit, in the PlanChange shape web/src/lib/mock/types.ts types.
// step_added, step_removed and step_reordered are unreachable from repair by
// construction — they exist for M4's human refine turn.
type Change struct {
	Kind   string
	Step   string
	Detail string
	From   string
	To     string
}

const (
	valueChanged     = "value_changed"
	assertionAdded   = "assertion_added"
	assertionRemoved = "assertion_removed"
)

// Changes is what a repair actually did, for the revision the dashboard renders.
// A refused repair still produces rows: what the model reached for is the point.
func Changes(before, after plan.Step) []Change {
	var out []Change
	add := func(kind, detail, from, to string) {
		out = append(out, Change{Kind: kind, Step: before.Label(), Detail: detail, From: from, To: to})
	}

	if before.Request.Method != after.Request.Method {
		add(valueChanged, "method", before.Request.Method, after.Request.Method)
	}
	if before.Request.URL != after.Request.URL {
		add(valueChanged, "url", before.Request.URL, after.Request.URL)
	}
	for _, c := range mapDiff("header", before.Request.Headers, after.Request.Headers) {
		out = append(out, withStep(c, before.Label()))
	}
	for _, c := range mapDiff("query", before.Request.Query, after.Request.Query) {
		out = append(out, withStep(c, before.Label()))
	}
	if b, a := jsonOf(before.Request.Body), jsonOf(after.Request.Body); b != a {
		add(valueChanged, "body", b, a)
	}

	for i, a := range after.Extract {
		if i < len(before.Extract) && before.Extract[i] != a {
			add(valueChanged, "extract "+a.Name, before.Extract[i].Path, a.Path)
		}
	}

	for i, a := range after.Assertions {
		if i >= len(before.Assertions) {
			add(assertionAdded, describeAssertion(a), "", "")
			continue
		}
		if b := before.Assertions[i]; b.Target != a.Target {
			add(valueChanged, fmt.Sprintf("%s %s target", b.Type, b.Target), b.Target, a.Target)
		} else if b.Operator != a.Operator || fmt.Sprint(b.Expected) != fmt.Sprint(a.Expected) {
			add(valueChanged, "assertion "+a.Target, describeAssertion(b), describeAssertion(a))
		}
	}
	for i := len(after.Assertions); i < len(before.Assertions); i++ {
		add(assertionRemoved, describeAssertion(before.Assertions[i]), "", "")
	}
	return out
}

func withStep(c Change, step string) Change {
	c.Step = step
	return c
}

// mapDiff reports added, removed and edited keys in a stable order, so two runs
// of the same repair record the same rows.
func mapDiff(what string, before, after map[string]string) []Change {
	keys := map[string]bool{}
	for k := range before {
		keys[k] = true
	}
	for k := range after {
		keys[k] = true
	}

	names := make([]string, 0, len(keys))
	for k := range keys {
		names = append(names, k)
	}
	sort.Strings(names)

	var out []Change
	for _, k := range names {
		if before[k] != after[k] {
			out = append(out, Change{Kind: valueChanged, Detail: what + " " + k, From: before[k], To: after[k]})
		}
	}
	return out
}

func describeAssertion(a plan.Assertion) string {
	s := fmt.Sprintf("%s %s %s", a.Type, a.Target, a.Operator)
	if a.Operator != plan.Exists {
		s += " " + fmt.Sprint(a.Expected)
	}
	return s
}

func jsonOf(v map[string]any) string {
	if len(v) == 0 {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

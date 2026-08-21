package plan

import (
	"strings"
	"testing"
)

// stored is plan_json as web/src/lib/db/drafts.ts writes it: variables, covers and
// steps, and nothing that names the plan. Parse refuses this, which is the whole
// reason Assemble exists.
func stored(steps ...string) []byte {
	return []byte(`{"variables":{},
		"covers":[{"method":"GET","path":"/x"}],
		"steps":[` + strings.Join(steps, ",") + `]}`)
}

func TestAssembleTakesStoredPlanJson(t *testing.T) {
	p, err := Assemble(stored(step("a"), step("b", "a")), "room types", 3, "http://x")
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "room types" || p.Version != 3 || p.BaseURL != "http://x" {
		t.Fatalf("columns did not land: %q v%d %q", p.Name, p.Version, p.BaseURL)
	}
	if len(p.Steps) != 2 {
		t.Fatalf("steps = %d, want 2", len(p.Steps))
	}
}

func TestParseStillRefusesStoredPlanJson(t *testing.T) {
	if _, err := Parse(stored(step("a"))); err == nil {
		t.Fatal("Parse took a plan_json body, so covers would be silently ignored")
	}
}

func TestAssembleValidatesLikeLoad(t *testing.T) {
	body := []byte(`{"variables":{},"covers":[],"steps":[` + step("a", "nowhere") + `]}`)
	if _, err := Assemble(body, "p", 1, "http://x"); err == nil {
		t.Fatal("a plan from the queue was held to a lower bar than one from disk")
	}
}

func TestAssembleRefusesAnUnknownField(t *testing.T) {
	body := []byte(`{"variables":{},"steps":[` + step("a") + `],"summary":"..."}`)
	if _, err := Assemble(body, "p", 1, "http://x"); err == nil {
		t.Fatal("an unknown key in plan_json passed unnoticed")
	}
}

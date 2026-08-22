package app

import (
	"testing"

	"github.com/gritqa/cli/internal/plan"
)

// The bug this closes: one stale mapping in run.variables refused every plan on the
// machine, including the ones that never wanted the credential.
func TestUnsetIgnoresVariablesThePlanNeverReads(t *testing.T) {
	quiet := &plan.Plan{Steps: []plan.Step{{Request: plan.Request{URL: "/health"}}}}
	if got := unset(quiet, []string{"adminPassword ($GRITQA_ADMIN_PASSWORD)", "guestPassword ($GRITQA_GUEST_PASSWORD)"}); got != nil {
		t.Errorf("unset() = %v, want nil for a plan that reads neither", got)
	}

	reader := &plan.Plan{Steps: []plan.Step{{Request: plan.Request{
		URL:  "/login",
		Body: map[string]any{"password": "{{adminPassword}}"},
	}}}}
	got := unset(reader, []string{"adminPassword ($GRITQA_ADMIN_PASSWORD)", "guestPassword ($GRITQA_GUEST_PASSWORD)"})
	if len(got) != 1 || got[0] != "adminPassword ($GRITQA_ADMIN_PASSWORD)" {
		t.Errorf("unset() = %v, want [adminPassword]", got)
	}
}

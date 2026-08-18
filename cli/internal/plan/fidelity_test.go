package plan

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// TestCheckoutTaxRoundTrips is the contract with the dashboard. The fixture is
// CHECKOUT_TAX out of web/src/lib/mock/plans.ts in planJson()'s shape, so a
// field silently dropped here is a field the UI writes and the CLI ignores.
func TestCheckoutTaxRoundTrips(t *testing.T) {
	raw, err := os.ReadFile("testdata/checkout-tax.json")
	if err != nil {
		t.Fatal(err)
	}

	p, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}

	out, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}

	// Compared as decoded values: Go sorts map keys on marshal, so bytes differ
	// where meaning does not.
	var want, got any
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Fatalf("the plan did not survive the trip\n want %s\n  got %s", raw, out)
	}
}

func TestCheckoutTaxReadsLikeTheUI(t *testing.T) {
	p, err := Load("testdata/checkout-tax.json")
	if err != nil {
		t.Fatal(err)
	}

	if len(p.Steps) != 5 {
		t.Errorf("stepCount = %d, want 5", len(p.Steps))
	}
	if n := p.AssertionCount(); n != 12 {
		t.Errorf("assertionCount = %d, want 12", n)
	}

	// covers, in the UI's own spelling: {{checkoutId}} collapses to :id.
	for _, want := range []string{
		"POST /checkout/quote", "POST /checkout", "POST /checkout/:id/tax", "GET /checkout/:id",
	} {
		if !contains(p.Endpoints(), want) {
			t.Errorf("Endpoints() is missing %s: %v", want, p.Endpoints())
		}
	}

	s4 := p.Steps[3]
	if a, d := s4.Attempts(); a != 2 || d != 250 {
		t.Errorf("s4 retry = %d attempts, %dms delay", a, d)
	}
	if p.Steps[4].OnFailure != Continue {
		t.Errorf("s5 onFailure = %q", p.Steps[4].OnFailure)
	}
	if got := p.Steps[0].Extract[0].Path; got != "$.data.token" {
		t.Errorf("extraction path = %q, want the $. spelling kept", got)
	}
}

func contains(hay []string, needle string) bool {
	for _, s := range hay {
		if s == needle {
			return true
		}
	}
	return false
}

package plan

import "testing"

func TestReferencesWalksEveryFieldBracesWalks(t *testing.T) {
	p := &Plan{
		Variables: map[string]string{"email": "guest-{{runId}}@example.com"},
		Steps: []Step{{
			Request: Request{
				URL:     "/orders/{{orderId}}",
				Headers: map[string]string{"Authorization": "Bearer {{token}}"},
				Query:   map[string]string{"since": "{{from}}"},
				Body:    map[string]any{"who": map[string]any{"name": "{{email}}"}, "tags": []any{"{{tag}}"}},
			},
			Action:     &Action{Statement: "select 1 from t where id = {{rowId}}", Command: "echo {{note}}"},
			Assertions: []Assertion{{Expected: "{{email}}"}},
		}},
	}

	got := p.References()
	for _, want := range []string{"runId", "orderId", "token", "from", "email", "tag", "rowId", "note"} {
		if !got[want] {
			t.Errorf("References() missed %q", want)
		}
	}
	if len(got) != 8 {
		t.Errorf("References() = %v, want 8 names", got)
	}
}

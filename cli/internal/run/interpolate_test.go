package run

import (
	"strings"
	"testing"
)

func TestText(t *testing.T) {
	vars := map[string]string{"orderId": "o_1", "token": "t_1"}

	for _, c := range []struct{ in, want string }{
		{"/orders/{{orderId}}", "/orders/o_1"},
		{"/orders/{{ orderId }}", "/orders/o_1"},
		{"Bearer {{token}}", "Bearer t_1"},
		{"{{orderId}}/{{token}}", "o_1/t_1"},
		{"/orders", "/orders"},
	} {
		got, err := Text(c.in, vars)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("%s → %s, want %s", c.in, got, c.want)
		}
	}
}

// An unbound variable is an error, not an empty string: /orders// tests nothing
// and reads like a server bug.
func TestTextUnbound(t *testing.T) {
	_, err := Text("/orders/{{orderId}}/items/{{itemId}}", nil)
	if err == nil {
		t.Fatal("want an error")
	}
	for _, name := range []string{"orderId", "itemId"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("%q does not name %s", err, name)
		}
	}
}

func TestDeepKeepsJSONTypes(t *testing.T) {
	in := map[string]any{
		"id":    "{{orderId}}",
		"qty":   float64(2),
		"paid":  true,
		"lines": []any{map[string]any{"sku": "{{sku}}"}},
	}
	got, err := Body(in, map[string]string{"orderId": "o_1", "sku": "s_1"})
	if err != nil {
		t.Fatal(err)
	}
	if got["id"] != "o_1" || got["qty"] != float64(2) || got["paid"] != true {
		t.Fatalf("got %#v", got)
	}
	line := got["lines"].([]any)[0].(map[string]any)
	if line["sku"] != "s_1" {
		t.Fatalf("nested: %#v", line)
	}
}

func TestStringsNamesTheKey(t *testing.T) {
	_, err := Strings(map[string]string{"Authorization": "Bearer {{token}}"}, nil)
	if err == nil || !strings.Contains(err.Error(), "Authorization") {
		t.Fatalf("err = %v", err)
	}
}

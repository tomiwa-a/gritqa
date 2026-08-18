package run

import (
	"encoding/json"
	"testing"
)

func decodeInto(dst *any, body string) error {
	return json.Unmarshal([]byte(body), dst)
}

func TestValue(t *testing.T) {
	var doc any
	if err := decodeInto(&doc, `{
		"data": {"user": {"id": "u_1"}, "items": [{"sku": "a"}, {"sku": "b"}], "tax": 66750},
		"ok": true
	}`); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		path  string
		want  any
		found bool
	}{
		// Extraction writes $., assertion targets do not. One reader, both spellings.
		{"$.data.user.id", "u_1", true},
		{"data.user.id", "u_1", true},
		{"data.items[1].sku", "b", true},
		{"data.tax", float64(66750), true},
		{"ok", true, true},
		{"data.missing", nil, false},
		{"data.items[5].sku", nil, false},
		{"data.user.id.deeper", nil, false},
		{"data.user[0]", nil, false},
		{"", nil, false},
		{"$", nil, false},
		{"data.items[x]", nil, false},
		{"data.items[-1]", nil, false},
		{"data.items[0", nil, false},
	}

	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			got, found := Value(doc, c.path)
			if found != c.found {
				t.Fatalf("found = %v, want %v", found, c.found)
			}
			if found && got != c.want {
				t.Fatalf("got %#v, want %#v", got, c.want)
			}
		})
	}
}

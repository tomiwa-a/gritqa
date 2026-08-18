package run

import (
	"fmt"
	"regexp"
	"strings"
)

// variable is the same spelling as VARIABLE in web/src/lib/plan.ts.
var variable = regexp.MustCompile(`\{\{\s*([\w.]+)\s*\}\}`)

// Text substitutes every {{var}} in s. An unbound variable is an error rather
// than an empty string: a request to /checkout//tax tests nothing and reads
// like a server bug.
func Text(s string, vars map[string]string) (string, error) {
	var missing []string

	out := variable.ReplaceAllStringFunc(s, func(m string) string {
		name := variable.FindStringSubmatch(m)[1]
		v, ok := vars[name]
		if !ok {
			missing = append(missing, name)
			return m
		}
		return v
	})

	if len(missing) > 0 {
		return "", fmt.Errorf("nothing has set %s yet", strings.Join(dedupe(missing), " or "))
	}
	return out, nil
}

// Strings interpolates a header or query map.
func Strings(m map[string]string, vars map[string]string) (map[string]string, error) {
	if len(m) == 0 {
		return nil, nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		got, err := Text(v, vars)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", k, err)
		}
		out[k] = got
	}
	return out, nil
}

// Deep interpolates strings anywhere inside a decoded JSON value. Numbers and
// booleans are left as they are; this is how a request body and an assertion's
// expected value both get their variables.
func Deep(v any, vars map[string]string) (any, error) {
	switch t := v.(type) {
	case string:
		return Text(t, vars)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, inner := range t {
			got, err := Deep(inner, vars)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", k, err)
			}
			out[k] = got
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, inner := range t {
			got, err := Deep(inner, vars)
			if err != nil {
				return nil, err
			}
			out[i] = got
		}
		return out, nil
	default:
		return v, nil
	}
}

func Body(m map[string]any, vars map[string]string) (map[string]any, error) {
	if len(m) == 0 {
		return nil, nil
	}
	got, err := Deep(m, vars)
	if err != nil {
		return nil, err
	}
	return got.(map[string]any), nil
}

func dedupe(in []string) []string {
	seen := make(map[string]bool, len(in))
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

package run

import (
	"fmt"
	"strconv"
	"strings"
)

// Value reads a dotted path out of decoded JSON. Extraction paths are written
// $.data.token and assertion targets data.token, so the prefix is optional.
func Value(doc any, path string) (any, bool) {
	segs, err := segments(path)
	if err != nil {
		return nil, false
	}

	cur := doc
	for _, s := range segs {
		if s.key == "" {
			arr, ok := cur.([]any)
			if !ok || s.index >= len(arr) {
				return nil, false
			}
			cur = arr[s.index]
			continue
		}
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		next, ok := obj[s.key]
		if !ok {
			return nil, false
		}
		cur = next
	}
	return cur, true
}

type segment struct {
	key   string
	index int
}

func segments(path string) ([]segment, error) {
	p := strings.TrimSpace(path)
	p = strings.TrimPrefix(p, "$")
	p = strings.TrimPrefix(p, ".")

	var out []segment
	for i := 0; i < len(p); {
		switch p[i] {
		case '.':
			i++
		case '[':
			end := strings.IndexByte(p[i:], ']')
			if end < 0 {
				return nil, fmt.Errorf("%q has a [ that is never closed", path)
			}
			raw := p[i+1 : i+end]
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 {
				return nil, fmt.Errorf("%q indexes with %q, which is not a position", path, raw)
			}
			out = append(out, segment{index: n})
			i += end + 1
		default:
			j := i
			for j < len(p) && p[j] != '.' && p[j] != '[' {
				j++
			}
			out = append(out, segment{key: p[i:j], index: -1})
			i = j
		}
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("%q points at nothing", path)
	}
	return out, nil
}

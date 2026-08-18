package run

import (
	"fmt"

	"github.com/gritqa/cli/internal/plan"
)

// Extract binds a step's values into the variable map. Everything is stored as
// text, so {{taxTotal}} interpolates exactly the way it compares.
func Extract(es []plan.Extraction, res *Response, vars map[string]string) error {
	for _, e := range es {
		if e.Source == plan.FromHeader {
			v := res.Headers.Get(e.Path)
			if v == "" {
				return fmt.Errorf("the response has no %s header, so %s is unset", e.Path, e.Name)
			}
			vars[e.Name] = v
			continue
		}

		if res.JSON == nil {
			return fmt.Errorf("the response is not JSON, so %s cannot be read", e.Name)
		}
		v, ok := Value(res.JSON, e.Path)
		if !ok {
			return fmt.Errorf("the response has no %s, so %s is unset", e.Path, e.Name)
		}
		vars[e.Name] = normalise(v)
	}
	return nil
}

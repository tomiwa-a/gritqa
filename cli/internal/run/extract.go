package run

import (
	"fmt"

	"github.com/gritqa/cli/internal/plan"
)

// Extract binds a step's values into the variable map. Everything is stored as
// text, so {{taxTotal}} interpolates exactly the way it compares.
func Extract(es []plan.Extraction, res *Response, vars map[string]string) error {
	for _, e := range es {
		switch e.Source {
		case plan.FromHeader:
			v := res.Headers.Get(e.Path)
			if v == "" {
				return fmt.Errorf("the response has no %s header, so %s is unset", e.Path, e.Name)
			}
			vars[e.Name] = v
		case plan.FromBody, plan.FromResult:
			if res.JSON == nil {
				return fmt.Errorf("the response is not JSON, so %s cannot be read", e.Name)
			}
			v, ok := Value(res.JSON, e.Path)
			if !ok {
				return fmt.Errorf("the response has no %s, so %s is unset", e.Path, e.Name)
			}
			vars[e.Name] = normalise(v)
		case plan.FromStdout:
			if res.JSON == nil {
				return fmt.Errorf("no stdout available for extraction of %s", e.Name)
			}
			v, ok := Value(res.JSON, e.Path)
			if !ok {
				return fmt.Errorf("the response has no %s, so %s is unset", e.Path, e.Name)
			}
			vars[e.Name] = normalise(v)
		default:
			return fmt.Errorf("extraction source %q is not recognised", e.Source)
		}
	}
	return nil
}

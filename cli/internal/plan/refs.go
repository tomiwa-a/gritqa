package plan

// References is every variable name the plan reads.
//
// Not the same set as the names a machine supplies: a config entry the plan never
// mentions cannot decide this run's outcome. Walks the fields braces() walks, so a
// place a variable may be read is a place it is counted.
func (p *Plan) References() map[string]bool {
	found := map[string]bool{}
	for _, v := range p.Variables {
		refsIn(v, found)
	}
	for _, s := range p.Steps {
		refsIn(s.Request.URL, found)
		for _, m := range []map[string]string{s.Request.Headers, s.Request.Query} {
			for _, v := range m {
				refsIn(v, found)
			}
		}
		deepRefs(s.Request.Body, found)
		if s.Action != nil {
			refsIn(s.Action.Statement, found)
			refsIn(s.Action.Command, found)
		}
		for _, a := range s.Assertions {
			deepRefs(a.Expected, found)
		}
	}
	return found
}

func refsIn(s string, found map[string]bool) {
	for _, m := range variable.FindAllStringSubmatch(s, -1) {
		found[m[1]] = true
	}
}

func deepRefs(v any, found map[string]bool) {
	switch t := v.(type) {
	case string:
		refsIn(t, found)
	case map[string]any:
		for _, inner := range t {
			deepRefs(inner, found)
		}
	case []any:
		for _, inner := range t {
			deepRefs(inner, found)
		}
	}
}

package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Load reads a plan file and validates it. Nothing is sent anywhere until this
// returns: a half-understood plan runs the wrong requests against a real API.
func Load(path string) (*Plan, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(b)
}

func Parse(b []byte) (*Plan, error) {
	var p Plan
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("this is not a plan I recognise: %w", err)
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return &p, nil
}

var (
	methods = map[string]bool{
		"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
	}
	assertionTypes = map[AssertionType]bool{
		Status: true, BodyField: true, HeaderField: true, ResponseTime: true,
	}
	operators = map[Operator]bool{
		Equals: true, NotEquals: true, Contains: true, NotContains: true,
		Exists: true, LT: true, GT: true,
	}
)

// Validate rejects everything that would otherwise surface as a confusing
// mid-run failure. onFailure is defaulted rather than rejected, because a
// hand-written plan leaving it out means the safe thing.
func (p *Plan) Validate() error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("the plan has no name")
	}
	if len(p.Steps) == 0 {
		return fmt.Errorf("%q has no steps", p.Name)
	}

	if p.Variables == nil {
		p.Variables = map[string]string{}
	}

	seen := make(map[string]bool, len(p.Steps))
	for i := range p.Steps {
		s := &p.Steps[i]
		where := fmt.Sprintf("step %d", i+1)
		if s.Name != "" {
			where = fmt.Sprintf("step %d (%s)", i+1, s.Name)
		}

		if s.ID == "" {
			return fmt.Errorf("%s has no id", where)
		}
		if seen[s.ID] {
			return fmt.Errorf("two steps share the id %q", s.ID)
		}
		seen[s.ID] = true

		s.Request.Method = strings.ToUpper(strings.TrimSpace(s.Request.Method))
		if !methods[s.Request.Method] {
			return fmt.Errorf("%s uses the method %q, which I cannot send",
				where, s.Request.Method)
		}
		if strings.TrimSpace(s.Request.URL) == "" {
			return fmt.Errorf("%s has no url", where)
		}

		switch s.OnFailure {
		case "":
			s.OnFailure = Abort
		case Abort, Continue:
		default:
			return fmt.Errorf("%s says onFailure %q, which is neither abort nor continue",
				where, s.OnFailure)
		}

		if err := validateExtractions(s.Extract, where); err != nil {
			return err
		}
		if err := validateAssertions(s.Assertions, where); err != nil {
			return err
		}
		if s.Retry != nil && s.Retry.MaxAttempts < 1 {
			return fmt.Errorf("%s asks for %d attempts", where, s.Retry.MaxAttempts)
		}

		// Empty rather than null, so a plan written back out keeps the shape the
		// dashboard writes.
		if s.DependsOn == nil {
			s.DependsOn = []string{}
		}
		if s.Extract == nil {
			s.Extract = []Extraction{}
		}
		if s.Assertions == nil {
			s.Assertions = []Assertion{}
		}
	}

	for i, s := range p.Steps {
		for _, dep := range s.DependsOn {
			if dep == s.ID {
				return fmt.Errorf("step %d (%s) depends on itself", i+1, s.Name)
			}
			if !seen[dep] {
				return fmt.Errorf("step %d (%s) depends on %q, which is not in the plan",
					i+1, s.Name, dep)
			}
		}
	}

	_, err := p.Order()
	return err
}

func validateExtractions(es []Extraction, where string) error {
	for _, e := range es {
		if e.Name == "" {
			return fmt.Errorf("%s extracts a value into no name", where)
		}
		if strings.TrimSpace(e.Path) == "" {
			return fmt.Errorf("%s extracts %q from no path", where, e.Name)
		}
		if e.Source != FromBody && e.Source != FromHeader {
			return fmt.Errorf("%s extracts %q from %q, which is neither body nor header",
				where, e.Name, e.Source)
		}
	}
	return nil
}

func validateAssertions(as []Assertion, where string) error {
	for _, a := range as {
		if !assertionTypes[a.Type] {
			return fmt.Errorf("%s asserts on %q, which is not a thing I can check", where, a.Type)
		}
		if !operators[a.Operator] {
			return fmt.Errorf("%s uses the operator %q", where, a.Operator)
		}
		if (a.Type == BodyField || a.Type == HeaderField) && strings.TrimSpace(a.Target) == "" {
			return fmt.Errorf("%s asserts on a %s with no target", where, a.Type)
		}
		if a.Operator != Exists && a.Expected == nil {
			return fmt.Errorf("%s asserts %s %s with nothing to compare against",
				where, a.Target, a.Operator)
		}
	}
	return nil
}

// Order returns the steps with every dependency ahead of the step that needs
// it. Ties keep declaration order, so a plan runs the way it reads.
func (p *Plan) Order() ([]Step, error) {
	done := make(map[string]bool, len(p.Steps))
	out := make([]Step, 0, len(p.Steps))
	placed := make([]bool, len(p.Steps))

	for len(out) < len(p.Steps) {
		progressed := false
		for i, s := range p.Steps {
			if placed[i] || !ready(s, done) {
				continue
			}
			placed[i], progressed = true, true
			done[s.ID] = true
			out = append(out, s)
		}
		if !progressed {
			return nil, fmt.Errorf("these steps depend on each other in a circle: %s",
				strings.Join(stuck(p.Steps, placed), ", "))
		}
	}
	return out, nil
}

func ready(s Step, done map[string]bool) bool {
	for _, dep := range s.DependsOn {
		if !done[dep] {
			return false
		}
	}
	return true
}

func stuck(steps []Step, placed []bool) []string {
	var out []string
	for i, s := range steps {
		if !placed[i] {
			out = append(out, s.ID)
		}
	}
	return out
}

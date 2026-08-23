package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
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
		RowCount: true, ValueEquals: true, ExitCode: true, StdoutContains: true,
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
	for name, v := range p.Variables {
		if err := literal(v, "the variable "+name); err != nil {
			return err
		}
	}

	seen := make(map[string]bool, len(p.Steps))
	for i := range p.Steps {
		s := &p.Steps[i]
		where := fmt.Sprintf("step %d", i+1)
		if s.Name != "" {
			where = fmt.Sprintf("step %d (%s)", i+1, s.Name)
		}

		if seen[s.ID] {
			return fmt.Errorf("two steps share the id %q", s.ID)
		}
		if err := validateStep(s, where); err != nil {
			return err
		}
		seen[s.ID] = true
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

// reference is a {{name}} the interpolator will actually substitute — the same
// spelling run.Text uses.
var reference = regexp.MustCompile(`\{\{\s*[\w.]+\s*\}\}`)

// literal rejects a {{ that is not a variable reference. A model reaching for
// {{randomInt 1 9}} or {{roomTypeName Updated}} writes something the
// interpolator leaves alone, so the braces are sent to the API as written and
// the step tests nothing. Caught here, before a single request goes out.
// ValidateStep holds one step to the same bar a whole plan is held to. M3's
// repair goes through it: a fix that would not have loaded from disk must not be
// sent at a real API either.
func ValidateStep(s *Step) error { return validateStep(s, "the step "+s.Label()) }

func validateStep(s *Step, where string) error {
	if s.ID == "" {
		return fmt.Errorf("%s has no id", where)
	}

	switch s.Kind {
	case HTTPStep, "": // empty defaults to HTTP at execution time
		return validateHTTPStep(s, where)
	case SQLStep:
		return validateSQLStep(s, where)
	case ShellStep:
		return validateShellStep(s, where)
	default:
		return fmt.Errorf("%s has kind %q, which is not one of http, sql, shell", where, s.Kind)
	}
}

func validateHTTPStep(s *Step, where string) error {
	s.Request.Method = strings.ToUpper(strings.TrimSpace(s.Request.Method))
	if !methods[s.Request.Method] {
		return fmt.Errorf("%s uses the method %q, which I cannot send", where, s.Request.Method)
	}
	if strings.TrimSpace(s.Request.URL) == "" {
		return fmt.Errorf("%s has no url", where)
	}
	return validateCommon(s, where)
}

func validateSQLStep(s *Step, where string) error {
	if s.Action == nil {
		return fmt.Errorf("%s is a sql step with no action", where)
	}
	if strings.TrimSpace(s.Action.Statement) == "" {
		return fmt.Errorf("%s has no statement", where)
	}
	if s.Action.Target != "" && s.Action.Target != Setup && s.Action.Target != Verify {
		return fmt.Errorf("%s has target %q, which is neither setup nor verify", where, s.Action.Target)
	}
	return validateCommon(s, where)
}

func validateShellStep(s *Step, where string) error {
	if s.Action == nil {
		return fmt.Errorf("%s is a shell step with no action", where)
	}
	if strings.TrimSpace(s.Action.Command) == "" {
		return fmt.Errorf("%s has no command", where)
	}
	return validateCommon(s, where)
}

// validateCommon checks fields shared by all step kinds.
func validateCommon(s *Step, where string) error {
	switch s.OnFailure {
	case "":
		s.OnFailure = Abort
	case Abort, Continue:
	default:
		return fmt.Errorf("%s says onFailure %q, which is neither abort nor continue",
			where, s.OnFailure)
	}

	if err := braces(s, where); err != nil {
		return err
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
	return nil
}

func literal(s, where string) error {
	if !strings.Contains(reference.ReplaceAllString(s, ""), "{{") {
		return nil
	}
	return fmt.Errorf("%s reads %s — {{ }} holds one variable name and nothing else, "+
		"so this would be sent exactly as written", where, clip(s))
}

func clip(s string) string {
	if len(s) > 60 {
		s = s[:60] + "…"
	}
	return strconv.Quote(s)
}

// braces checks every place a variable may be read.
func braces(s *Step, where string) error {
	// HTTP steps — check request fields.
	if s.Request.URL != "" {
		if err := literal(s.Request.URL, where+" url"); err != nil {
			return err
		}
	}
	for _, m := range []map[string]string{s.Request.Headers, s.Request.Query} {
		for k, v := range m {
			if err := literal(v, where+" "+k); err != nil {
				return err
			}
		}
	}
	if err := deepBraces(s.Request.Body, where+" body"); err != nil {
		return err
	}
	// SQL steps — check statement.
	if s.Action != nil && s.Action.Statement != "" {
		if err := literal(s.Action.Statement, where+" statement"); err != nil {
			return err
		}
	}
	// Shell steps — check command.
	if s.Action != nil && s.Action.Command != "" {
		if err := literal(s.Action.Command, where+" command"); err != nil {
			return err
		}
	}
	for i, a := range s.Assertions {
		if err := deepBraces(a.Expected, fmt.Sprintf("%s check %d", where, i+1)); err != nil {
			return err
		}
	}
	return nil
}

func deepBraces(v any, where string) error {
	switch t := v.(type) {
	case string:
		return literal(t, where)
	case map[string]any:
		for k, inner := range t {
			if err := deepBraces(inner, where+" "+k); err != nil {
				return err
			}
		}
	case []any:
		for i, inner := range t {
			if err := deepBraces(inner, fmt.Sprintf("%s[%d]", where, i)); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateExtractions(es []Extraction, where string) error {
	for _, e := range es {
		if e.Name == "" {
			return fmt.Errorf("%s extracts a value into no name", where)
		}
		if strings.TrimSpace(e.Path) == "" {
			return fmt.Errorf("%s extracts %q from no path", where, e.Name)
		}
		switch e.Source {
		case FromBody, FromHeader, FromResult, FromStdout:
		default:
			return fmt.Errorf("%s extracts %q from %q, which is not a recognised source",
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
		// Only the types that need to be told where to look. rowCount, exitCode and
		// stdoutContains each name their own channel, so a target on one is
		// decoration -- carried, ignored, and not required.
		if (a.Type == BodyField || a.Type == HeaderField || a.Type == ValueEquals) &&
			strings.TrimSpace(a.Target) == "" {
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

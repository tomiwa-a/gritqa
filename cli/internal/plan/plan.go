// Package plan is a test plan as the dashboard writes it and the runner reads
// it. The shape mirrors planJson() in web/src/lib/plan.ts field for field: this
// is the contract between the two halves of the product.
package plan

import (
	"regexp"
	"strings"
)

// variable is the {{ name }} spelling shared with web/src/lib/plan.ts.
var variable = regexp.MustCompile(`\{\{\s*[\w.]+\s*\}\}`)

type Plan struct {
	Name        string            `json:"name"`
	Version     int               `json:"version"`
	Description string            `json:"description"`
	BaseURL     string            `json:"baseUrl"`
	Variables   map[string]string `json:"variables"`
	Steps       []Step            `json:"steps"`
}

type StepKind string

const (
	HTTPStep  StepKind = "http"
	SQLStep   StepKind = "sql"
	ShellStep StepKind = "shell"
)

type Step struct {
	ID          string       `json:"id"`
	Kind        StepKind     `json:"kind,omitempty"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	DependsOn   []string     `json:"dependsOn"`
	Request     Request      `json:"request"`
	Action      *Action      `json:"action,omitempty"`
	Extract     []Extraction `json:"extract"`
	Assertions  []Assertion  `json:"assertions"`
	OnFailure   OnFailure    `json:"onFailure"`
	Retry       *Retry       `json:"retry,omitempty"`
}

type Request struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    map[string]any    `json:"body,omitempty"`
	Query   map[string]string `json:"query,omitempty"`
}

// Action carries the payload for non-HTTP steps. SQL steps use Statement and
// Target; shell steps use Command. HTTP steps leave this nil.
type Action struct {
	Statement string `json:"statement,omitempty"`
	Target    Target `json:"target,omitempty"`
	Command   string `json:"command,omitempty"`
}

// Target is what a SQL step is for. Setup executes and reports rows affected;
// Verify queries and reports the rows themselves, which is the evidence a 201 is
// not. Empty reads as Setup.
type Target string

const (
	Setup  Target = "setup"
	Verify Target = "verify"
)

type Extraction struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Source Source `json:"source"`
}

type Assertion struct {
	Type     AssertionType `json:"type"`
	Operator Operator      `json:"operator"`
	Target   string        `json:"target"`
	// Expected keeps its JSON type. 200, "open", false and "{{taxTotal}}" are
	// all valid, and the last one has to be interpolated before it is compared.
	Expected any `json:"expected,omitempty"`
}

// Retry counts total attempts, so maxAttempts 1 means one.
type Retry struct {
	MaxAttempts int `json:"maxAttempts"`
	DelayMs     int `json:"delayMs"`
}

type OnFailure string

const (
	Abort    OnFailure = "abort"
	Continue OnFailure = "continue"
)

type Source string

const (
	FromBody   Source = "body"
	FromHeader Source = "header"
	FromResult Source = "result"
	FromStdout Source = "stdout"
)

type AssertionType string

const (
	Status         AssertionType = "status"
	BodyField      AssertionType = "bodyField"
	HeaderField    AssertionType = "header"
	ResponseTime   AssertionType = "responseTime"
	RowCount       AssertionType = "rowCount"
	ValueEquals    AssertionType = "valueEquals"
	ExitCode       AssertionType = "exitCode"
	StdoutContains AssertionType = "stdoutContains"
)

type Operator string

const (
	Equals      Operator = "equals"
	NotEquals   Operator = "notEquals"
	Contains    Operator = "contains"
	NotContains Operator = "notContains"
	Exists      Operator = "exists"
	LT          Operator = "lt"
	GT          Operator = "gt"
)

// AssertionCount is what the dashboard shows next to a plan.
func (p *Plan) AssertionCount() int {
	n := 0
	for _, s := range p.Steps {
		n += len(s.Assertions)
	}
	return n
}

func (s Step) Label() string {
	if s.Name != "" {
		return s.Name
	}
	if s.Kind == SQLStep && s.Action != nil {
		stmt := s.Action.Statement
		if len(stmt) > 40 {
			stmt = stmt[:40] + "..."
		}
		return "SQL " + stmt
	}
	if s.Kind == ShellStep && s.Action != nil {
		cmd := s.Action.Command
		if len(cmd) > 40 {
			cmd = cmd[:40] + "..."
		}
		return "shell " + cmd
	}
	return s.Request.Method + " " + s.Request.URL
}

// Attempts is the retry budget, one when the plan says nothing.
func (s Step) Attempts() (n int, delayMs int) {
	if s.Retry == nil || s.Retry.MaxAttempts < 1 {
		return 1, 0
	}
	return s.Retry.MaxAttempts, s.Retry.DelayMs
}

// Endpoints is the METHOD /path list a plan touches, with variables collapsed
// the way endpointPathOf does in web/src/lib/plan.ts.
func (p *Plan) Endpoints() []string {
	seen := make(map[string]bool, len(p.Steps))
	var out []string
	for _, s := range p.Steps {
		if s.Kind != HTTPStep && s.Kind != "" {
			continue
		}
		path := variable.ReplaceAllString(strings.Split(s.Request.URL, "?")[0], ":id")
		sig := s.Request.Method + " " + path
		if !seen[sig] {
			seen[sig] = true
			out = append(out, sig)
		}
	}
	return out
}

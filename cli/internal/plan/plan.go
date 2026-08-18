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

type Step struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	DependsOn   []string     `json:"dependsOn"`
	Request     Request      `json:"request"`
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
)

type AssertionType string

const (
	Status       AssertionType = "status"
	BodyField    AssertionType = "bodyField"
	HeaderField  AssertionType = "header"
	ResponseTime AssertionType = "responseTime"
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
		path := variable.ReplaceAllString(strings.Split(s.Request.URL, "?")[0], ":id")
		sig := s.Request.Method + " " + path
		if !seen[sig] {
			seen[sig] = true
			out = append(out, sig)
		}
	}
	return out
}

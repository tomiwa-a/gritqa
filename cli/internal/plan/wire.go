package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Stored is plan_json as the dashboard writes it. The name, version and base URL
// are columns beside it, so a plan arriving from the queue is assembled out of
// both halves rather than parsed from one.
type Stored struct {
	Variables   map[string]string `json:"variables"`
	Assumptions []string          `json:"assumptions"`
	Covers      []Covered         `json:"covers"`
	Steps       []Step            `json:"steps"`
	Checks      []Check           `json:"checks"`
}

// Covered is an endpoint the plan claims to exercise: bookkeeping the runner has
// no use for, declared so an unknown field stays an error.
type Covered struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

// Check is one step's verdict from the dashboard's verification pass: same
// standing as Covered. The runner owns pass and fail and never consults these;
// they are declared so the shape they travel in stays an error when it drifts.
type Check struct {
	StepID  string `json:"stepId"`
	Verdict string `json:"verdict"`
	Note    string `json:"note"`
	Trial   *Trial `json:"trial,omitempty"`
}

// Trial is what a trial_call answered for the step, when one was made. Evidence
// the grid reads as proof; the runner does not act on it.
type Trial struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Code   int    `json:"code"`
}

// Assemble joins stored text to the columns beside it, and holds the result to the
// same bar as a plan read off disk.
func Assemble(body []byte, name string, version int, baseURL string) (*Plan, error) {
	var s Stored
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("this is not a plan I recognise: %w", err)
	}

	p := &Plan{
		Name:      name,
		Version:   version,
		BaseURL:   baseURL,
		Variables: s.Variables,
		Steps:     s.Steps,
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return p, nil
}

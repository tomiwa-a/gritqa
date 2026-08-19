// Package draft writes a test plan from what changed. The model is always the
// user's own: reached directly with their key now, through the server that
// stores it from M4.
package draft

import (
	"context"

	"github.com/gritqa/cli/internal/plan"
)

type Drafter interface {
	Draft(ctx context.Context, req Request) (*plan.Plan, error)
}

// Request is what the model needs and nothing more: the file the plan is for,
// every endpoint the project serves so the plan can sign in before it calls a
// guarded one, and the plans that already exist so a new one does not repeat them.
type Request struct {
	Project string
	BaseURL string
	// Focus is the file this plan is for. Files may carry one more — how to log
	// in — because a plan that cannot authenticate proves nothing.
	Focus string
	// Brief is the user's own words for what the plan must prove. When it is set
	// it is the authority, and Focus is empty: the source is only how to do it.
	Brief string
	// Name titles the plan when the user named it.
	Name string
	// Cover are the endpoints the plan must exercise, when the user picked them
	// rather than a whole file.
	Cover []string
	// Variables are names the run seeds from the user's environment — admin
	// credentials, mostly. Names only: a value never reaches a prompt, and a
	// drafted plan references them without declaring them.
	Variables []string
	Files     []File
	Endpoints []Endpoint
	Existing  []Existing
}

type File struct {
	Path     string
	Language string
	Content  string
}

type Endpoint struct {
	Signature string
	File      string
	Handler   string
	NeedsAuth bool
}

// Existing is a plan the project already has, named by what it covers.
type Existing struct {
	Name      string
	Endpoints []string
}

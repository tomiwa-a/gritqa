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

// Request is what the model needs and nothing more: the files that changed, the
// endpoints they register, and the plans that already exist so a new one does
// not repeat them.
type Request struct {
	Project   string
	BaseURL   string
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

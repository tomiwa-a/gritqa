// Package agent is the judgement half of a run: when a step fails it decides
// whether the test was wrong, and when a run passes it says whether the run
// proved anything. It edits the plan and never the user's source.
package agent

import (
	"context"
	"errors"
	"fmt"

	"github.com/tomiwa-a/gritqa/cli/internal/model"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
)

// Confidence is what a green run is worth. Proved false is a warning, never a
// failure: the deterministic engine owns pass and fail.
type Confidence struct {
	Proved bool     `json:"proved"`
	Why    string   `json:"why"`
	Gaps   []string `json:"gaps"`
}

type ConfirmRequest struct {
	Plan        string
	Description string
	Steps       []run.StepResult
}

// Local judges with the user's own key, straight to their model endpoint. It is
// the same relationship draft.Local has to draft.Server.
type Local struct {
	*model.Client
}

// NewLocal returns nil when no model is reachable, because a run with no
// repairer is still a run — plans written by hand execute either way.
func NewLocal(endpoint, name string, creds model.Credentials) (*Local, error) {
	c, err := model.New(endpoint, name, creds)
	switch {
	case errors.Is(err, model.ErrNoKey), errors.Is(err, model.ErrNoModel):
		return nil, nil
	case err != nil:
		return nil, err
	}
	return &Local{Client: c}, nil
}

// Repair asks once per attempt. There is no correction turn: the engine's own
// loop is the retry, and it re-asks with the failure the last fix produced.
func (l *Local) Repair(ctx context.Context, req run.RepairRequest) (*run.Fix, error) {
	raw, err := l.Complete(ctx, repairMessages(req))
	if err != nil {
		return nil, err
	}
	fix, err := parseFix(raw, req.Step)
	if err != nil {
		return nil, fmt.Errorf("the model's repair made no sense: %w", err)
	}
	return fix, nil
}

func (l *Local) Confirm(ctx context.Context, req ConfirmRequest) (*Confidence, error) {
	raw, err := l.Complete(ctx, confirmMessages(req))
	if err != nil {
		return nil, err
	}
	return parseConfidence(raw)
}

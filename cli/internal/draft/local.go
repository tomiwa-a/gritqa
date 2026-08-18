package draft

import (
	"context"
	"errors"
	"fmt"

	"github.com/gritqa/cli/internal/model"
	"github.com/gritqa/cli/internal/plan"
)

// attempts is how many replies are asked for before a plan that will not
// validate is reported instead of patched.
const attempts = 2

// Local drafts with the user's own key, straight to their model endpoint.
type Local struct {
	*model.Client
}

// NewLocal drafts with whatever credentials the project has. With none there is
// no drafting, exactly as the settings page promises.
func NewLocal(endpoint, name string, creds model.Credentials) (*Local, error) {
	c, err := model.New(endpoint, name, creds)
	switch {
	case errors.Is(err, model.ErrNoKey):
		return nil, fmt.Errorf("drafting needs a model key — export %s, or set "+
			"run.model.token_command. Without one you can still write plans by hand "+
			"and GritQA will run them", model.KeyEnv)
	case errors.Is(err, model.ErrNoModel):
		return nil, fmt.Errorf("drafting needs a model name — add run.model.name to your "+
			"config, or export %s", model.ModelEnv)
	case err != nil:
		return nil, err
	}
	return &Local{Client: c}, nil
}

// Draft asks for a plan and validates the answer. One bad reply gets one
// correction, then it is reported rather than guessed at.
func (l *Local) Draft(ctx context.Context, req Request) (*plan.Plan, error) {
	msgs := messages(req)

	for attempt := 1; attempt <= attempts; attempt++ {
		raw, err := l.Complete(ctx, msgs)
		if err != nil {
			return nil, err
		}
		p, perr := Parse(raw)
		if perr == nil {
			return finish(p, req), nil
		}
		if attempt == attempts {
			return nil, fmt.Errorf("the model wrote a plan I could not use: %w", perr)
		}
		msgs = append(msgs,
			model.Message{Role: "assistant", Content: raw},
			model.Message{Role: "user", Content: correction(perr)})
	}
	return nil, errors.New("no plan was drafted")
}

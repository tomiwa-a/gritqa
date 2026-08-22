package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gritqa/cli/internal/cloud"
	"github.com/gritqa/cli/internal/term"
)

// settled is how long a dial has to last before its ending counts as ordinary
// rather than as a failure worth backing off from.
const settled = 5 * time.Second

// dialOut serves the read surface over a connection this machine opened, which is
// the only way a hosted dashboard reaches a laptop (decision 24). It runs beside the
// loopback listener rather than instead of it: one tool surface, two ways in.
func (a *attached) dialOut(ctx context.Context) {
	if a.srv == nil {
		return
	}

	var wait time.Duration
	var announced, noRelay bool
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		up, err := a.c.Dial(ctx, a.id.InstanceID)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			// A refused token ends this quietly: the poll loop is holding the same
			// one and is the right place to say so.
			var no *cloud.Unauthorized
			if errors.As(err, &no) {
				return
			}
			var refused *cloud.Refused
			if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
				if !noRelay {
					noRelay = true
					a.w.Write(term.Line{Kind: term.Info, Text: "this dashboard has no relay yet, so it can " +
						"research this project only while it is running on this machine"})
				}
				wait = pollCeiling
				continue
			}
			wait = slower(wait)
			continue
		}

		if !announced {
			announced = true
			a.w.Write(term.Line{Kind: term.Info,
				Text: "the dashboard can research this project over a connection this machine opened"})
		}

		began := time.Now()
		err = a.srv.Dial(ctx, up)
		up.Close()
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			a.w.Write(term.Line{Kind: term.Info, Text: "the dialled surface ended: " + err.Error()})
		}
		if time.Since(began) > settled {
			wait = 0
			continue
		}
		wait = slower(wait)
	}
}

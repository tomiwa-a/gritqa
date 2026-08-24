package app

import (
	"context"
	"errors"
	"net/http"

	"github.com/gritqa/cli/internal/cloud"
	"github.com/gritqa/cli/internal/sandbox"
	"github.com/gritqa/cli/internal/term"
)

// environment sends the compose file up and takes down whatever a person approved
// for it. The compose file is a fact about this machine and the answer is a
// judgement somebody made in a browser, so the two travel in one round trip: the
// answer can never be for a file other than the one about to boot.
//
// It runs when the loop attaches, so the screen has rows the moment gritqa is up,
// and again before every boot, so an approval given a minute ago is the one that
// boots. Nothing here fails a run: a dashboard with no route for this yet leaves
// whatever the local store already had as what boots.
func (a *attached) environment(ctx context.Context) {
	c, err := composeFor(ctx, a.cfg)
	if err != nil {
		return
	}
	judged, err := a.c.PushCompose(ctx, cloud.Declared(a.id.InstanceID, c))
	if err != nil {
		var no *cloud.Refused
		if errors.As(err, &no) && no.Status == http.StatusNotFound {
			a.w.Write(term.Line{Kind: term.Info, Text: "this dashboard cannot say how a project boots " +
				"yet, so that stays a question for this machine"})
			return
		}
		a.w.Write(term.Line{Kind: term.Info, Text: "the dashboard was not asked how this project " +
			"boots: " + err.Error()})
		return
	}
	switch {
	case judged.Approved():
		a.approved(ctx, *judged.Environment, judged.Fingerprint)
	case judged.Status == "proposed":
		a.w.Write(term.Line{Kind: term.Info, Text: "there is a proposal on the dashboard for how this " +
			"project boots, and nothing boots on it until somebody has looked at it"})
	}
}

// approved writes the answer into the local cache, which is where a boot already
// reads from. The dashboard is the record and this is the copy, so the boot path
// gains no third author.
func (a *attached) approved(ctx context.Context, e sandbox.Environment, fingerprint string) {
	if fingerprint != "" {
		e.Fingerprint = fingerprint
	}
	body, err := e.Encode()
	if err != nil {
		return
	}
	st := a.history(ctx)
	if st == nil {
		return
	}
	if held, err := st.Environment(); err == nil && held == body {
		return
	}
	if err := st.SaveEnvironment(e.Fingerprint, sandbox.AuthorApproved, body); err != nil {
		a.w.Write(term.Line{Kind: term.Info, Text: "could not keep the dashboard's answer: " + err.Error()})
		return
	}
	a.w.Write(term.Line{Kind: term.OK, Text: "how this project boots came from the dashboard — " + e.Describe()})
}

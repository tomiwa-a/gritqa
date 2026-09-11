package app

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/cloud"
	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/creds"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

// pushes is the dashboard, for the two flows that are not the attach loop: --draft
// and --plan. Decision 36 says the record is Postgres and the local store is the
// buffer, and until now that was only true of a run the dashboard had asked for.
//
// A project nobody linked gets a nil one, and every method on a nil pushes does
// nothing, so neither caller has a branch to write.
type pushes struct {
	c      *cloud.Client
	id     string
	server string
	root   string
	store  *index.Store
	w      *term.Writer
}

// Summaries for the revision thread. Two, because a plan reaching the dashboard
// because somebody ran it is a different event from one drafted there.
const (
	draftedHere = "Drafted on this machine."
	ranHere     = "Ran on this machine before the dashboard had it."
)

// pushing needs a link and somewhere local to remember what a draft file became.
// Without the second, a re-push looks like a second plan rather than a version, so
// no store means no push.
//
// cloud.New rather than connect(): connect falls through to the device flow, and a
// --draft that opens a browser is not one.
func pushing(w *term.Writer, cfg *config.Config, opts Options, store *index.Store) *pushes {
	if store == nil {
		return nil
	}
	c, err := cloud.New(opts.server(), cfg.Root())
	if err != nil {
		return nil
	}
	id, err := creds.InstanceID()
	if err != nil {
		return nil
	}
	return &pushes{c: c, id: id, server: opts.server(), root: cfg.Root(), store: store, w: w}
}

// plan sends one plan up and remembers what it became. Returns the dashboard's id
// for it, or "" when it did not land.
//
// Nothing here fails the caller. A plan on this machine and not in the record is
// worth more than a drafting pass that ended in an error.
func (p *pushes) plan(ctx context.Context, file string, pl *plan.Plan, summary string) string {
	if p == nil {
		return ""
	}
	key := p.key(file)
	held, err := p.store.RemotePlan(p.server, key)
	if err != nil {
		held = ""
	}

	got, err := p.c.PushPlan(ctx, cloud.Drafted(p.id, held, pl, summary))
	if held != "" && gone(err) {
		// The id this machine held is not a plan there any more, so the text is a
		// new plan rather than a version of a deleted one.
		got, err = p.c.PushPlan(ctx, cloud.Drafted(p.id, "", pl, summary))
	}
	if err != nil {
		p.w.Write(term.Line{Kind: term.Info, Text: pl.Name + " is only on this machine: " + err.Error()})
		return ""
	}
	if err := p.store.SaveRemotePlan(p.server, key, got.PlanID, got.Version); err != nil {
		p.w.Write(term.Line{Kind: term.Info, Text: "the dashboard holds this plan, and this machine " +
			"did not remember which: " + err.Error()})
	}
	return got.PlanID
}

// run files a finished run. The plan goes first when this file has never been up,
// because test_executions has no run without a plan to hang it on.
func (p *pushes) run(ctx context.Context, file string, pl *plan.Plan, base string,
	started time.Time, res *run.Result, container string) {
	if p == nil {
		return
	}
	id := p.held(ctx, file, pl)
	if id == "" {
		return
	}

	rep := cloud.Reported(p.id, pl, base, res, container)
	got, err := p.c.PushExecution(ctx, id, started, rep)
	if errors.Is(err, cloud.ErrNoPlan) {
		if id = p.plan(ctx, file, pl, ranHere); id == "" {
			return
		}
		got, err = p.c.PushExecution(ctx, id, started, rep)
	}
	if err != nil {
		p.w.Write(term.Line{Kind: term.Info, Text: "this run is only in the local history: " + err.Error()})
		return
	}
	p.w.Write(term.Line{Kind: term.Info, Text: "recorded as run " + got.Run})
}

// held is the plan id for a file, pushing the text only when there is none. A run
// must not make a version: re-running an approved plan is not an edit to it.
func (p *pushes) held(ctx context.Context, file string, pl *plan.Plan) string {
	if id, err := p.store.RemotePlan(p.server, p.key(file)); err == nil && id != "" {
		return id
	}
	return p.plan(ctx, file, pl, ranHere)
}

// key is how a draft file is named in remote_plans: repo-relative, forward slashes,
// so --plan .gritqa/drafts/x.json and --plan /abs/.../x.json are one plan and not
// two.
func (p *pushes) key(file string) string {
	abs, err := filepath.Abs(file)
	if err != nil {
		return filepath.ToSlash(file)
	}
	rel, err := filepath.Rel(p.root, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return filepath.ToSlash(abs)
	}
	return filepath.ToSlash(rel)
}

// gone is the dashboard saying it has no such plan.
func gone(err error) bool {
	var no *cloud.Refused
	return errors.As(err, &no) && no.Status == http.StatusNotFound
}

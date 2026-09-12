package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/cloud"
	"github.com/tomiwa-a/gritqa/cli/internal/creds"
	"github.com/tomiwa-a/gritqa/cli/internal/index"
	"github.com/tomiwa-a/gritqa/cli/internal/index/progress"
	"github.com/tomiwa-a/gritqa/cli/internal/mcp"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
	"github.com/tomiwa-a/gritqa/cli/internal/run"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

const (
	// Under the reap's ninety seconds by enough that one lost packet does not cost
	// the job.
	heartbeatEvery = 30 * time.Second
	// Reporting gets a deadline of its own, because the run it is reporting may
	// have ended by being interrupted.
	reportWithin = 30 * time.Second
	pollCeiling  = time.Minute
)

// attached is the poll loop: one machine, one project, one job at a time. It holds
// the session the research surface holds, so a second run arrives to a warm
// sandbox and a warm index.
type attached struct {
	*session
	c   *cloud.Client
	id  cloud.Identity
	srv *mcp.Server
	tok string
	// prog is the index pass's live object while a reindex job runs it. Nil
	// the rest of the time, so the poll carries no stale label.
	prog atomic.Pointer[progress.Progress]
	// last is the latest finished pass, held so idle polls keep narrating it.
	// The dashboard holds the last label the same way it holds last_seen: a
	// quiet machine still has something true to show.
	last atomic.Pointer[progress.State]
}

// attach is the poll loop: one machine, one project, one job at a time. It
// registers the machine and runs the first pass itself, so the dashboard
// narrates the initial read live instead of meeting the project at the mirror.
func attach(ctx context.Context, s *session, srv *mcp.Server, token string) error {
	w, cfg, opts := s.w, s.cfg, s.opts

	c, err := connect(ctx, w, cfg, opts)
	if err != nil {
		return err
	}
	machine, err := creds.InstanceID()
	if err != nil {
		return err
	}
	host, _ := os.Hostname()

	a := &attached{
		session: s,
		c:       c,
		id:      cloud.Identity{InstanceID: machine, Hostname: host, Version: opts.Version},
		srv:     srv,
		tok:     token,
	}

	go a.dialOut(ctx)

	// The row first, then the pass: the poll below quotes the live object, so
	// the dashboard watches this read happen instead of learning about it at
	// the mirror. Best-effort — an unreachable dashboard still gets a local
	// index, exactly like before.
	prog := progress.New(nil)
	a.prog.Store(prog)
	a.opts.Progress = prog
	a.opts.ProgressPost = func() {
		// Fire-and-forget with its own deadline: a slow dashboard must never
		// stall the pass it is narrating, and a lost post is just a skipped
		// frame — the next stage, the next poll, the mirror all follow.
		go func() {
			out, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
			defer cancel()
			_ = c.Register(out, a.reporting())
		}()
	}
	if err := c.Register(ctx, a.reporting()); err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "the dashboard is not answering, " +
			"so this pass stays local: " + err.Error()})
	}

	// Verdicts first: an unjudged or contradictory setup fails here, in seconds,
	// instead of minutes later when a boot or a draft needs it. The stack itself
	// boots once, when the first job needs it — a consistent environment needs no
	// proof boot first.
	if _, err := checkConfigured(ctx, w, cfg); err != nil {
		return err
	}

	got, err := read(ctx, w, cfg, a.opts)
	if err != nil {
		return err
	}
	a.snap = got.snap
	a.keep(prog.Snapshot())

	a.mirror(ctx, got.snap)
	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Info, Text: "waiting for approved plans — Ctrl-C to stop"})

	var wait time.Duration
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}

		got, err := a.c.Claim(ctx, a.reporting())
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			// A token no amount of retrying fixes, against a dashboard that may
			// simply be down: the first ends the loop, the second slows it.
			var no *cloud.Unauthorized
			if errors.As(err, &no) {
				return err
			}
			w.Write(term.Line{Kind: term.Info, Text: err.Error()})
			wait = slower(wait)
			continue
		}

		if got.Reaped > 0 {
			w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("took back %s whose machine stopped answering",
				term.Count(got.Reaped, "job", "jobs"))})
		}
		if got.Job != nil {
			a.work(ctx, got.Job)
		}
		wait = got.PollAfter()
	}
}

// reporting is the identity as it stands right now. The research address is read
// per poll rather than captured at startup, because a surface that stopped must
// stop being advertised: the dashboard clears the column when the field is absent,
// so an unreachable port becomes "start it" instead of a fetch that fails.
func (a *attached) reporting() cloud.Identity {
	id := a.id
	if a.srv != nil && a.tok != "" {
		if addr, ok := a.srv.Live(); ok {
			id.MCPUrl, id.MCPToken = "http://"+addr, a.tok
		}
	}
	// A pass in flight first, then the latest finished one, then silence: an
	// idle poll carries no label rather than a stale one it cannot defend.
	if prog := a.prog.Load(); prog != nil {
		snap := prog.Snapshot()
		id.Progress = &snap
	} else if last := a.last.Load(); last != nil {
		id.Progress = last
	}
	return id
}

// keep holds a finished pass for idle polls to quote.
func (a *attached) keep(state progress.State) {
	a.last.Store(&state)
}

func slower(d time.Duration) time.Duration {
	if d < 2*time.Second {
		return 2 * time.Second
	}
	if d*2 > pollCeiling {
		return pollCeiling
	}
	return d * 2
}

func (a *attached) work(ctx context.Context, job *cloud.Job) {
	switch job.Type {
	case cloud.JobExecute:
		a.execute(ctx, job)
	case cloud.JobIndex:
		a.reindex(ctx, job)
	default:
		a.giveBack(ctx, job, "this machine does not know what a "+job.Type+" job is")
	}
}

// mirror sends the index up. The dashboard's copy is not correctness-bearing, so
// nothing here stops the loop — a dashboard with no route for it yet gets one line
// saying what that costs.
func (a *attached) mirror(ctx context.Context, snap *index.Snapshot) {
	if snap == nil {
		return
	}
	got, err := a.c.PushIndex(ctx, cloud.Mirror(a.id.InstanceID, snap))
	if err != nil {
		var no *cloud.Refused
		if errors.As(err, &no) && no.Status == http.StatusNotFound {
			a.w.Write(term.Line{Kind: term.Info, Text: "this dashboard has nowhere to put an index yet, " +
				"so its codebase page reads empty"})
			return
		}
		a.w.Write(term.Line{Kind: term.Info, Text: "the index was not sent: " + err.Error()})
		return
	}
	a.w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("sent %s to the dashboard",
		term.Count(got.Written, "file", "files"))})
}

// reindex answers an index_codebase job with a fresh pass and a push.
func (a *attached) reindex(ctx context.Context, job *cloud.Job) {
	// The heartbeat is the dashboard's only sighting mid-pass: without it a
	// model-heavy reindex outlasts the reap's patience and gets handed to
	// another machine while this one is doing it perfectly well.
	walk, stop := context.WithCancel(ctx)
	defer stop()
	var taken atomic.Bool
	go a.beat(walk, job.PublicID, func() { taken.Store(true); stop() })

	prog := progress.New(nil)
	a.prog.Store(prog)
	a.opts.Progress = prog
	defer func() {
		a.prog.Store(nil)
		a.opts.Progress = nil
	}()

	a.mu.Lock()
	got, err := read(walk, a.w, a.cfg, a.opts)
	if err == nil {
		a.snap = got.snap
	}
	a.mu.Unlock()
	if err != nil {
		// Lost to another machine: the walk is already stopped, and the job
		// is theirs to report. Anything else goes back with its reason.
		if taken.Load() {
			return
		}
		a.giveBack(ctx, job, err.Error())
		return
	}
	a.keep(prog.Snapshot())

	sent, err := a.c.PushIndex(ctx, cloud.Mirror(a.id.InstanceID, got.snap))
	if err != nil {
		a.giveBack(ctx, job, err.Error())
		return
	}
	a.w.Write(term.Line{Kind: term.OK, Text: fmt.Sprintf("the dashboard now holds %s",
		term.Count(sent.Written, "file", "files"))})
	a.settle(ctx, job, cloud.Report{InstanceID: a.id.InstanceID, Outcome: "passed"})
}

func (a *attached) execute(ctx context.Context, job *cloud.Job) {
	var payload cloud.RunPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		a.stumbled(ctx, job, "this job's payload is not one I can read: "+err.Error())
		return
	}
	p, err := plan.Assemble(payload.Plan, payload.PlanName, payload.PlanVersion, payload.BaseURL)
	if err != nil {
		a.stumbled(ctx, job, err.Error())
		return
	}

	// The heartbeat covers staging as well as the walk: a cold sandbox takes longer
	// to boot than the reap's patience, and nothing sends a step during that.
	walk, stop := context.WithCancel(ctx)
	defer stop()
	var taken atomic.Bool
	go a.beat(walk, job.PublicID, func() { taken.Store(true); stop() })

	a.w.Write(term.Line{Kind: term.Blank})
	pre, err := a.prepare(walk, p)
	if err != nil {
		a.abandoned(ctx, job, taken.Load(), err)
		return
	}

	a.w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("running %s against %s — %s",
		p.Name, pre.base, term.Count(len(p.Steps), "step", "steps"))})
	a.w.Write(term.Line{Kind: term.Blank})
	a.w.Write(term.Line{Kind: term.Out, Text: "what happened"})

	// The dashboard gets each step as it lands. Closed before the completion, never
	// after: a preview still in flight would land on top of the record. Held on the
	// session context rather than the walk's, so cancelling the walk does not throw
	// away the steps still queued from it.
	live := a.c.Live(ctx, job.PublicID, a.id.InstanceID, pre.base, p)
	defer live.Close()

	done := 0
	started := time.Now()
	// Buffered rather than printed as it happens, exactly as --plan does it: the
	// tree line for a step has to come first, and repair settles before it is written.
	var pending []run.Attempt
	res, err := pre.engine(func(s run.StepResult) {
		live.Send(done, s)
		done++
		a.w.Write(term.Line{
			Kind:   term.Tree,
			Text:   s.Name,
			Meta:   stepMeta(s),
			Status: tone(s.Status),
			Last:   done == len(p.Steps),
		})
		for _, at := range pending {
			a.w.Write(term.Line{Kind: term.Info, Text: "  " + repairNote(at)})
		}
		pending = pending[:0]
	}, func(at run.Attempt) {
		pending = append(pending, at)
	}).Run(walk, p)
	stop()
	live.Close()

	switch {
	case err != nil:
		a.abandoned(ctx, job, taken.Load(), err)
		return
	case taken.Load():
		return
	case ctx.Err() != nil:
		a.giveBack(ctx, job, "the machine running this was interrupted")
		return
	}

	record(a.w, a.history(ctx), execution(payload.PlanPublicID, pre.base, started, res))
	a.summary(res, pre.stack != nil)
	a.settle(ctx, job, cloud.Reported(a.id.InstanceID, p, pre.base, res, pre.container))
}

// abandoned covers a job that never reached a verdict. Three different things, and
// they settle differently: the server took it back, so there is nothing to say; the
// operator stopped, so it goes back for whoever is next; or this machine could not
// do it, which is a run that ends as an error with the reason attached.
func (a *attached) abandoned(ctx context.Context, job *cloud.Job, taken bool, err error) {
	switch {
	case taken:
	case ctx.Err() != nil:
		a.giveBack(ctx, job, "the machine running this was interrupted")
	default:
		a.stumbled(ctx, job, err.Error())
	}
}

func (a *attached) summary(res *run.Result, sandboxed bool) {
	w := a.w
	w.Write(term.Line{Kind: term.Blank})
	if res.Status == run.RunPassed {
		w.Write(term.Line{
			Kind: term.OK,
			Text: "all " + term.Count(len(res.Steps), "step", "steps") + " passed",
			Meta: term.Dur(res.Elapsed),
		})
	} else {
		w.Write(term.Line{
			Kind: term.Fail,
			Text: fmt.Sprintf("%d of %d steps passed", res.Passed(), len(res.Steps)),
			Meta: term.Dur(res.Elapsed),
		})
		for _, s := range res.Steps {
			for _, r := range reasons(s) {
				w.Write(term.Line{Kind: term.Info, Text: s.Name + ": " + r})
			}
		}
	}
	if sandboxed {
		ledger(w, res)
	}
}

// settle delivers a finished job. On its own context: a dashboard left showing a run
// as running until the reaper notices is the worst of the outcomes available.
func (a *attached) settle(ctx context.Context, job *cloud.Job, rep cloud.Report) {
	out, cancel := context.WithTimeout(context.WithoutCancel(ctx), reportWithin)
	defer cancel()

	done, err := a.c.Complete(out, job.PublicID, rep)
	switch {
	case errors.Is(err, cloud.ErrLostJob):
		a.w.Write(term.Line{Kind: term.Info, Text: "the dashboard had already given this job to " +
			"another machine, so these results are only in the local history"})
	case err != nil:
		a.w.Write(term.Line{Kind: term.Info, Text: "these results did not reach the dashboard: " + err.Error()})
	case done.Run != "":
		a.w.Write(term.Line{Kind: term.Info, Text: "reported as run " + done.Run})
	}
}

// stumbled settles a run this machine took and could not carry out. A completion
// rather than a release, because the reason belongs on the execution where the run
// report shows it.
func (a *attached) stumbled(ctx context.Context, job *cloud.Job, why string) {
	a.w.Write(term.Line{Kind: term.Fail, Text: why})
	a.settle(ctx, job, cloud.Failed(a.id.InstanceID, why))
}

// giveBack hands a job to whoever can do it. For delivery going wrong, never for a
// test that failed — a failed test is a job that succeeded.
func (a *attached) giveBack(ctx context.Context, job *cloud.Job, why string) {
	out, cancel := context.WithTimeout(context.WithoutCancel(ctx), reportWithin)
	defer cancel()

	outcome, err := a.c.Release(out, job.PublicID, a.id.InstanceID, why)
	switch {
	case err != nil:
		a.w.Write(term.Line{Kind: term.Info, Text: "could not give this job back: " + err.Error()})
	case outcome == "dead":
		a.w.Write(term.Line{Kind: term.Fail, Text: fmt.Sprintf("this job is out of attempts: %s", why)})
	default:
		a.w.Write(term.Line{Kind: term.Info, Text: "gave this job back: " + why})
	}
}

// beat keeps the claim alive while the job runs, and cancels the job when the
// server says it belongs to someone else.
func (a *attached) beat(ctx context.Context, job string, lost func()) {
	t := time.NewTicker(heartbeatEvery)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			var prog *progress.State
			if p := a.prog.Load(); p != nil {
				snap := p.Snapshot()
				prog = &snap
			}
			if err := a.c.Heartbeat(ctx, job, a.id.InstanceID, prog); errors.Is(err, cloud.ErrLostJob) {
				a.w.Write(term.Line{Kind: term.Info, Text: "the dashboard has handed this job to " +
					"another machine, so this run is being abandoned"})
				lost()
				return
			}
		}
	}
}

// history is the local cache, which decision 36 makes the buffer rather than the
// record: a run that could not be reported is still readable here.
func (a *attached) history(ctx context.Context) *index.Store {
	a.mu.Lock()
	defer a.mu.Unlock()

	store, _, err := a.cached(ctx)
	if err != nil {
		return nil
	}
	return store
}

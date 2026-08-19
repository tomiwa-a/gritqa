package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/agent"
	"github.com/gritqa/cli/internal/config"
	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/term"
)

// handlerCap bounds the source sent with a repair. A 71 KB controller holds the
// failing handler and twenty of its siblings, and the model reads it whole.
const handlerCap = 48 << 10

// runPlan executes one plan file and renders the RUN transcript, in the same
// shape read() renders READ.
func runPlan(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options) error {
	p, err := plan.Load(opts.PlanFile)
	if err != nil {
		return err
	}

	base, err := baseURL(w, cfg, p)
	if err != nil {
		return err
	}
	if err := probe(ctx, cfg, base); err != nil {
		return err
	}

	store, snap := cache(w, cfg)
	if store != nil {
		defer store.Close()
	}

	judge, err := repairer(w, cfg)
	if err != nil {
		return err
	}

	w.Write(term.Line{
		Kind: term.Info,
		Text: fmt.Sprintf("running %s against %s — %s",
			p.Name, base, term.Count(len(p.Steps), "step", "steps")),
	})
	w.Write(term.Line{Kind: term.Blank})
	w.Write(term.Line{Kind: term.Out, Text: "what happened"})

	done := 0
	var all, pending []run.Attempt
	engine := &run.Engine{
		BaseURL: base,
		OnStep: func(s run.StepResult) {
			done++
			w.Write(term.Line{
				Kind:   term.Tree,
				Text:   s.Name,
				Meta:   stepMeta(s),
				Status: tone(s.Status),
				Last:   done == len(p.Steps),
			})
			// Buffered rather than printed as it happens: the tree line for this
			// step has to come first, and repair settles before it is written.
			for _, a := range pending {
				w.Write(term.Line{Kind: term.Info, Text: "  " + repairNote(a)})
			}
			pending = pending[:0]
		},
	}
	if judge != nil {
		o := cfg.Run.RepairOpts()
		engine.Repairer, engine.Attempts, engine.Budget = judge, o.Attempts, o.Budget
		engine.Handler = handlers(cfg.Root(), snap)
		engine.OnRepair = func(a run.Attempt) {
			all = append(all, a)
			pending = append(pending, a)
		}
	}

	started := time.Now()
	res, err := engine.Run(ctx, p)
	if err != nil {
		return err
	}

	var sure *agent.Confidence
	if judge != nil && !opts.NoConfirm && res.Status == run.RunPassed {
		sure = confirm(ctx, w, judge, p, res)
	}

	e := execution(opts.PlanFile, base, started, res)
	e.Revisions = revisions(all)
	if sure != nil {
		e.Confirmed = sql.NullBool{Bool: sure.Proved, Valid: true}
		e.ConfirmNote = sure.Why
	}
	record(w, store, e)

	w.Write(term.Line{Kind: term.Blank})
	if res.Status == run.RunPassed {
		w.Write(term.Line{
			Kind: term.OK,
			Text: fmt.Sprintf("all %s passed%s",
				term.Count(len(res.Steps), "step", "steps"), repaired(res)),
			Meta: term.Dur(res.Elapsed),
		})
		proof(w, sure)
		return nil
	}

	w.Write(term.Line{
		Kind: term.Fail,
		Text: fmt.Sprintf("%d of %d steps passed%s", res.Passed(), len(res.Steps), repaired(res)),
		Meta: term.Dur(res.Elapsed),
	})
	for _, s := range res.Steps {
		for _, r := range reasons(s) {
			w.Write(term.Line{Kind: term.Info, Text: s.Name + ": " + r})
		}
	}
	for _, a := range all {
		if a.Kind == run.CodeWrong {
			w.Write(term.Line{Kind: term.Info, Text: "awaiting your verdict: real bug, or bad test"})
			break
		}
	}
	return nil
}

// repairer builds the judgement half. Nil is a working configuration: a plan
// written by hand runs with no model at all, exactly as it did before M3.
func repairer(w *term.Writer, cfg *config.Config) (*agent.Local, error) {
	m := cfg.Run.ModelOpts()
	l, err := agent.NewLocal(m.Endpoint, m.Name, credentials(m))
	if err != nil {
		return nil, err
	}
	if l == nil {
		w.Write(term.Line{
			Kind: term.Info,
			Text: "no model is reachable, so a failed step will be reported rather than repaired",
		})
	}
	return l, nil
}

func confirm(ctx context.Context, w *term.Writer, l *agent.Local, p *plan.Plan, res *run.Result) *agent.Confidence {
	c, err := l.Confirm(ctx, agent.ConfirmRequest{
		Plan: p.Name, Description: p.Description, Steps: res.Steps,
	})
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "this run was not confirmed: " + err.Error()})
		return nil
	}
	return c
}

// proof reports what a green run was worth. Decision 16: it never touches the
// exit code, because the deterministic engine owns pass and fail.
func proof(w *term.Writer, c *agent.Confidence) {
	if c == nil {
		return
	}
	if c.Proved {
		w.Write(term.Line{Kind: term.Info, Text: "confirmed: " + c.Why})
		return
	}
	w.Write(term.Line{Kind: term.Info, Text: "this passed, but it may not have proved anything: " + c.Why})
	for _, g := range c.Gaps {
		w.Write(term.Line{Kind: term.Info, Text: "  " + g})
	}
}

func repaired(res *run.Result) string {
	if res.Repairs == 0 {
		return ""
	}
	return fmt.Sprintf(", %s spent on repair", term.Count(res.Repairs, "call", "calls"))
}

// repairNote is one attempt in one line, under the step it belongs to.
func repairNote(a run.Attempt) string {
	switch {
	case a.Err != "":
		return a.Err
	case a.Refused != "":
		return "the fix was declined: " + a.Refused
	case a.Kind == run.CodeWrong:
		return "the code looks wrong: " + a.Why
	case a.Kind == run.Unsure || a.After == nil:
		return "could not tell what went wrong: " + a.Why
	case a.Status == run.StepPassed:
		return "the test was wrong: " + a.Why
	}
	return "that fix did not help either: " + a.Why
}

func revisions(as []run.Attempt) []index.Revision {
	out := make([]index.Revision, 0, len(as))
	for _, a := range as {
		r := index.Revision{
			StepID:   a.StepID,
			Version:  a.N,
			Author:   "ai",
			Summary:  repairNote(a),
			Accepted: a.Accepted(),
		}
		if a.After != nil {
			for _, c := range agent.Changes(a.Before, *a.After) {
				r.Changes = append(r.Changes, index.ChangeRow{
					Kind: c.Kind, StepName: c.Step, Detail: c.Detail, From: c.From, To: c.To,
				})
			}
		}
		out = append(out, r)
	}
	return out
}

// cache opens the local history and the last index. Both are optional: a run
// still happens without them, it is just not recorded and repair sees no source.
func cache(w *term.Writer, cfg *config.Config) (*index.Store, *index.Snapshot) {
	store, err := index.Open(cfg.CachePath())
	if err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "the local cache would not open: " + err.Error()})
		return nil, nil
	}
	snap, err := store.Load(cfg.Root())
	if err != nil {
		return store, nil
	}
	return store, snap
}

// handlers resolves a step to the file serving it, by matching the step's URL
// against the routes the index found. Best-effort by design: a query-string path
// carrying a variable only matches on its literal head.
func handlers(root string, snap *index.Snapshot) func(plan.Step) run.Handler {
	if snap == nil {
		return nil
	}

	byURL := map[string]string{}
	for _, r := range snap.Routes {
		if _, ok := byURL[r.Path]; !ok {
			byURL[r.Path] = r.File
		}
		byURL[r.Method+" "+r.Path] = r.File
	}

	paths := make([]string, 0, len(byURL))
	for p := range byURL {
		paths = append(paths, p)
	}
	// Longest first, so controller=x&action=y wins over controller=x alone.
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })

	return func(s plan.Step) run.Handler {
		url := s.Request.URL
		if i := strings.Index(url, "{{"); i >= 0 {
			url = url[:i]
		}

		file := byURL[s.Request.Method+" "+url]
		if file == "" {
			file = byURL[url]
		}
		if file == "" {
			for _, p := range paths {
				if strings.HasPrefix(url, p) || strings.HasPrefix(p, url) {
					file = byURL[p]
					break
				}
			}
		}
		if file == "" {
			return run.Handler{}
		}

		b, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			return run.Handler{}
		}
		if len(b) > handlerCap {
			b = b[:handlerCap]
		}
		return run.Handler{Path: file, Content: string(b)}
	}
}

// record keeps the run in the local cache. A run that happened is worth more
// than a clean exit, so a storage failure is reported and swallowed.
func record(w *term.Writer, store *index.Store, e *index.Execution) {
	if store == nil {
		return
	}
	if _, err := store.SaveExecution(e); err != nil {
		w.Write(term.Line{Kind: term.Info, Text: "this run was not recorded: " + err.Error()})
	}
}

func execution(file, base string, started time.Time, res *run.Result) *index.Execution {
	e := &index.Execution{
		Plan:      res.Plan,
		PlanFile:  file,
		Status:    string(res.Status),
		Duration:  res.Elapsed,
		StartedAt: started,
		Steps:     make([]index.StepRow, 0, len(res.Steps)),
	}
	for _, s := range res.Steps {
		e.Steps = append(e.Steps, index.StepRow{
			StepID:   s.ID,
			Name:     s.Name,
			Status:   string(s.Status),
			Method:   s.Method,
			Path:     strings.TrimPrefix(s.URL, base),
			Code:     s.Code,
			Duration: s.Elapsed,
			Detail:   strings.Join(reasons(s), "; "),
		})
	}
	return e
}

// baseURL prefers the config, which describes this machine. The plan carries the
// URL it was drafted against, which can name a port that has since moved.
func baseURL(w *term.Writer, cfg *config.Config, p *plan.Plan) (string, error) {
	mine := cfg.Run.ResolvedBaseURL()
	theirs := strings.TrimRight(p.BaseURL, "/")

	switch {
	case mine == "" && theirs == "":
		return "", errors.New("nothing says where your API is — add run.base_url to " +
			config.Dir + "/" + config.Name)
	case mine == "":
		return theirs, nil
	}

	if theirs != "" && theirs != mine {
		w.Write(term.Line{
			Kind: term.Info,
			Text: fmt.Sprintf("the plan was drafted against %s; using %s from your config", theirs, mine),
		})
	}
	return mine, nil
}

// probe checks something is listening before sending twelve steps that would all
// fail with connection refused.
func probe(ctx context.Context, cfg *config.Config, base string) error {
	method, path, configured := cfg.Run.ReadyProbe()
	if !configured {
		method, path = "GET", "/"
	}

	req, err := http.NewRequestWithContext(ctx, method, base+path, nil)
	if err != nil {
		return err
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("nothing is answering at %s — start your API, or point run.base_url "+
			"somewhere that is up", base)
	}
	res.Body.Close()

	if configured && res.StatusCode >= 400 {
		return fmt.Errorf("%s %s answered %s, so your API is up but not ready",
			method, path, res.Status)
	}
	return nil
}

func stepMeta(s run.StepResult) string {
	switch s.Status {
	case run.StepSkipped, run.StepPending:
		return ""
	case run.StepError:
		if s.Code == 0 {
			return ""
		}
	}
	if s.Attempts > 1 {
		return fmt.Sprintf("%d %s, %s", s.Code, term.Count(s.Attempts, "try", "tries"), term.Dur(s.Elapsed))
	}
	return fmt.Sprintf("%d, %s", s.Code, term.Dur(s.Elapsed))
}

func tone(s run.StepStatus) term.Status {
	switch s {
	case run.StepPassed:
		return term.Pass
	case run.StepFailed, run.StepError:
		return term.Failed
	}
	return term.Skip
}

// reasons explains a step that did not pass. The operator wording lives here
// rather than in the engine: it is presentation, the same way plan.ts's map is.
func reasons(s run.StepResult) []string {
	switch s.Status {
	case run.StepError, run.StepSkipped:
		if s.Err == "" {
			return nil
		}
		return []string{s.Err}
	case run.StepFailed:
		var out []string
		for _, c := range s.Checks {
			if !c.Passed {
				out = append(out, describe(c))
			}
		}
		return out
	}
	return nil
}

var operatorWord = map[plan.Operator]string{
	plan.Equals:      "to be",
	plan.NotEquals:   "to be anything but",
	plan.Contains:    "to contain",
	plan.NotContains: "not to contain",
	plan.LT:          "under",
	plan.GT:          "over",
}

func describe(c run.Check) string {
	target := c.Target
	switch c.Type {
	case plan.Status:
		target = "the status"
	case plan.ResponseTime:
		target = "the response time"
	case plan.HeaderField:
		target = "the " + c.Target + " header"
	}

	if c.Operator == plan.Exists {
		return "expected " + target + " to be there, and it was not"
	}
	if !c.Found {
		return fmt.Sprintf("expected %s %s %s, and the response has no %s",
			target, operatorWord[c.Operator], c.Expected, target)
	}
	return fmt.Sprintf("expected %s %s %s, got %s",
		target, operatorWord[c.Operator], c.Expected, orNothing(c.Actual))
}

func orNothing(s string) string {
	if s == "" {
		return "nothing"
	}
	return s
}

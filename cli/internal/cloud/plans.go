package cloud

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/gritqa/cli/internal/plan"
)

// A plan drafted on this machine, pushed so the dashboard holds it.
//
//	POST /api/cli/plans   Authorization: Bearer <cli token>
//	{ "instanceId": "...", "planId": "..." | null, "name": "...",
//	  "description": "...", "baseUrl": "...", "variables": {...},
//	  "steps": [...], "covers": [...], "assumptions": [...], "summary": "..." }
//	-> 200 { "ok": true, "planId": "...", "version": 3, "changed": true }
//	   404 unknown    -- no such plan on this project
//	   409 archived   -- there is one, and it takes no new text
//
// planId absent creates a plan; present makes a new version of that one, and the
// draft file remembers which so a second push of the same file is a version rather
// than a second plan. changed false is the same text arriving twice: the version
// stands still, which is what stops a re-push looking like an edit.
const plansPath = "/api/cli/plans"

type PlanPush struct {
	InstanceID  string            `json:"instanceId"`
	PlanID      string            `json:"planId,omitempty"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	BaseURL     string            `json:"baseUrl"`
	Variables   map[string]string `json:"variables"`
	Steps       []PlanStep        `json:"steps"`
	Covers      []plan.Covered    `json:"covers"`
	Assumptions []string          `json:"assumptions"`
	Summary     string            `json:"summary,omitempty"`
}

// PlanStep is plan.Step shaped for the route rather than the step itself, and the
// difference is one field: Request is a pointer here. plan.Step carries it by
// value, so a sql step marshals `"request": {"method": "", "url": ""}` -- and the
// dashboard reads method against a list of five verbs, so an empty one is a
// rejected push rather than an absent request. Every other field is carried
// through untouched.
type PlanStep struct {
	ID          string            `json:"id"`
	Kind        string            `json:"kind,omitempty"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	DependsOn   []string          `json:"dependsOn"`
	Request     *plan.Request     `json:"request,omitempty"`
	Action      *plan.Action      `json:"action,omitempty"`
	Extract     []plan.Extraction `json:"extract"`
	Assertions  []plan.Assertion  `json:"assertions"`
	OnFailure   string            `json:"onFailure"`
	Retry       *plan.Retry       `json:"retry,omitempty"`
}

// Pushed is what the dashboard did with it.
type Pushed struct {
	PlanID  string `json:"planId"`
	Version int    `json:"version"`
	Changed bool   `json:"changed"`
}

func (c *Client) PushPlan(ctx context.Context, push PlanPush) (*Pushed, error) {
	r, err := c.call(ctx, http.MethodPost, plansPath, push)
	if err != nil {
		return nil, err
	}
	if !r.ok() {
		return nil, c.fail(plansPath, r)
	}
	out := &Pushed{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

// Drafted flattens a plan into a push. planID is "" for a file that has never been
// up before.
//
// summary is the CLI's own sentence rather than the model's: a draft file is a
// marshalled plan.Plan and holds no summary, no covers and no assumptions, so the
// three either get derived here or arrive empty.
func Drafted(instanceID, planID string, p *plan.Plan, summary string) PlanPush {
	steps := make([]PlanStep, 0, len(p.Steps))
	for _, s := range p.Steps {
		steps = append(steps, wireStep(s))
	}

	return PlanPush{
		InstanceID:  instanceID,
		PlanID:      planID,
		Name:        cut(p.Name, maxID),
		Description: cut(p.Description, maxMessage),
		BaseURL:     cut(p.BaseURL, maxURL),
		Variables:   vars(p.Variables),
		Steps:       steps,
		Covers:      covered(p),
		Assumptions: []string{},
		Summary:     cut(summary, 1000),
	}
}

func wireStep(s plan.Step) PlanStep {
	out := PlanStep{
		ID:          cut(s.ID, maxID),
		Name:        cut(s.Name, maxID),
		Description: cut(s.Description, maxMessage),
		// Empty rather than null on all three: the route reads them as lists that
		// are always there, and a nil slice marshals to null.
		DependsOn:  strs(s.DependsOn),
		Extract:    s.Extract,
		Assertions: assertions(s.Assertions),
		OnFailure:  string(s.OnFailure),
		Retry:      s.Retry,
	}
	if out.Name == "" {
		out.Name = out.ID
	}
	if out.Extract == nil {
		out.Extract = []plan.Extraction{}
	}
	// http stays unspelled, the same as it is in a report: it is what every plan
	// written before the other two kinds existed is made of, and the route reads an
	// absent kind as http.
	if s.Kind != plan.HTTPStep {
		out.Kind = string(s.Kind)
	}
	if s.Kind == plan.HTTPStep || s.Kind == "" {
		req := s.Request
		req.Method = strings.ToUpper(req.Method)
		out.Request = &req
	}
	if s.Action != nil {
		action := *s.Action
		out.Action = &action
	}
	// The runner defaults an unspelled onFailure to abort on load; the route asks
	// for one of the two words, so the default is spelled out here rather than left
	// to be a rejected push.
	if out.OnFailure == "" {
		out.OnFailure = string(plan.Abort)
	}
	return out
}

// assertions fills a target the runner did not need. rowCount, exitCode and
// stdoutContains each name their own channel, so the runner asks for no target on
// them -- the dashboard asks for one on every assertion, and names the thing itself
// as the answer, which is what status already carries.
func assertions(as []plan.Assertion) []plan.Assertion {
	out := make([]plan.Assertion, 0, len(as))
	for _, a := range as {
		if strings.TrimSpace(a.Target) == "" {
			a.Target = string(a.Type)
		}
		out = append(out, a)
	}
	return out
}

// covered is what the plan touches, read off the steps: the route takes covers as
// a route pattern and a verb, and Endpoints() already writes URLs that way -- query
// string off, {{ }} down to :id.
//
// Bookkeeping, and the runner has no use for it, so a verb the dashboard does not
// list is dropped rather than being allowed to refuse the whole plan.
func covered(p *plan.Plan) []plan.Covered {
	out := make([]plan.Covered, 0, len(p.Steps))
	for _, sig := range p.Endpoints() {
		method, path, ok := strings.Cut(sig, " ")
		if !ok || path == "" || !verbs[strings.ToUpper(method)] {
			continue
		}
		out = append(out, plan.Covered{Method: strings.ToUpper(method), Path: cut(path, maxPattern)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		return out[i].Method < out[j].Method
	})
	return out
}

// The verbs the dashboard's own schema lists.
var verbs = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}

func vars(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = cut(v, maxMessage)
	}
	return out
}

func strs(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

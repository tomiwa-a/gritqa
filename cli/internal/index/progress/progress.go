// Package progress carries an index run's live state: which stage is going,
// how far through it is, what file is being read, and what failed with what
// reason. It is deliberately boring data — counters and names, never file
// contents — so it is safe to print, to send over the machine's poll, and to
// store as the latest label on the dashboard.
//
// A nil *Progress is an off switch. Every method tolerates it, so callers pass
// opts.Progress straight through and code paths without a watcher change
// nothing.
package progress

import "sync"

// Stage is one rung of an index pass, in the order they run.
type Stage string

const (
	List   Stage = "list"
	Hash   Stage = "hash"
	Static Stage = "static"
	AI     Stage = "ai"
	Link   Stage = "link"
)

// Stages lists every stage in run order, for totals and UI.
var Stages = []Stage{List, Hash, Static, AI, Link}

// Event is one heartbeat of the pass: stage, how far, and what file this step
// was about. Failed carries the reason when the file could not be read;
// Cached says the answer came from the cache rather than fresh work.
type Event struct {
	Stage  Stage  `json:"stage"`
	Done   int    `json:"done"`
	Total  int    `json:"total"`
	File   string `json:"file,omitempty"`
	Cached bool   `json:"cached,omitempty"`
	Failed string `json:"failed,omitempty"`
}

// Failure is what the dashboard lists under a stage: which file, and why.
type Failure struct {
	Stage  Stage  `json:"stage"`
	File   string `json:"file"`
	Reason string `json:"reason"`
}

// Sink receives events. Implementations print them, forward them, or count
// them — the pass does not know which.
type Sink interface {
	Emit(Event)
}

// SinkFunc adapts a plain function, which is what most callers want.
type SinkFunc func(Event)

func (f SinkFunc) Emit(e Event) { f(e) }

// StageState is one rung's counters.
type StageState struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

// State is the pass as the dashboard shows it: where it is, every rung's
// counters, what is on the bench, and what broke. A copy, safe to hold past
// the run.
type State struct {
	Stage    Stage                `json:"stage"`
	Done     int                  `json:"done"`
	Total    int                  `json:"total"`
	Stages   map[Stage]StageState `json:"stages,omitempty"`
	File     string               `json:"file,omitempty"`
	Cached   int                  `json:"cached"`
	Fresh    int                  `json:"fresh"`
	Failed   int                  `json:"failed"`
	Failures []Failure            `json:"failures,omitempty"`
	Complete bool                 `json:"complete"`
}

// Progress accumulates events into State. The zero value is useless —
// construct with New — but a nil *Progress is a valid off switch.
type Progress struct {
	mu       sync.Mutex
	sinks    []Sink
	totals   map[Stage]int
	done     map[Stage]int
	file     map[Stage]string
	cached   int
	fresh    int
	failures []Failure
	stage    Stage
	complete bool
}

func New(sink Sink) *Progress {
	p := &Progress{
		totals: map[Stage]int{},
		done:   map[Stage]int{},
		file:   map[Stage]string{},
	}
	if sink != nil {
		p.sinks = append(p.sinks, sink)
	}
	return p
}

// Tap adds another watcher mid-pass: the terminal printer when a dashboard
// poll already owns the object, or vice versa. Every event from here on
// reaches every watcher.
func (p *Progress) Tap(sink Sink) {
	if p == nil || sink == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sinks = append(p.sinks, sink)
}

func (p *Progress) emit(e Event) {
	for _, sink := range p.sinks {
		sink.Emit(e)
	}
}

// SetTotal announces a stage's workload. Stages with no work still get a zero
// total, so a UI can show all five rungs instead of guessing which ran.
func (p *Progress) SetTotal(stage Stage, n int) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.totals[stage] = n
	p.stage = stage
	e := p.event(stage)
	p.mu.Unlock()
	p.emit(e)
}

// File records one file finished in a stage. Cached says the answer came from
// the cache: an unchanged hash in scan stages, an extraction hit in the AI
// stage. Fresh is the complement, counted here so the dashboard can say "312
// cached, 4 fresh" without re-deriving it.
func (p *Progress) File(stage Stage, file string, cached bool) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.done[stage]++
	p.file[stage] = file
	p.stage = stage
	if cached {
		p.cached++
	} else {
		p.fresh++
	}
	e := p.event(stage)
	p.mu.Unlock()
	p.emit(e)
}

// Pulse advances a stage without judging the file: the hash rung fills on
// full passes, but cached-vs-fresh is the parse and model stages' story to
// tell. (The fast-path hash check counts through File, because there it is
// the only reporter.)
func (p *Progress) Pulse(stage Stage, file string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.done[stage]++
	p.file[stage] = file
	p.stage = stage
	e := p.event(stage)
	p.mu.Unlock()
	p.emit(e)
}

// Fail records one file that could not be read, with the reason. A failed file
// still advances the stage — the pass continues past it, and the failure list
// is what says the numbers do not add up. Reasons are capped: they travel to
// the dashboard, whose columns are bounded.
func (p *Progress) Fail(stage Stage, file, reason string) {
	if p == nil {
		return
	}
	if len(reason) > 200 {
		reason = reason[:197] + "…"
	}
	p.mu.Lock()
	p.done[stage]++
	p.file[stage] = file
	p.stage = stage
	p.failures = append(p.failures, Failure{Stage: stage, File: file, Reason: reason})
	e := p.event(stage)
	p.mu.Unlock()
	p.emit(e)
}

// Complete marks one stage finished without per-file news: listing and linking
// are single shots, so there is nothing to count file by file.
func (p *Progress) Complete(stage Stage) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.done[stage] = p.totals[stage]
	p.stage = stage
	e := p.event(stage)
	p.mu.Unlock()
	p.emit(e)
}

// Reset clears every counter for a pass that restarts: a fast-path hash check
// that falls back to a full scan already counted those files once, and the
// full pass counting them again would report 254 of 127. Watchers stay —
// the terminal already printed true lines, and the dashboard replays.
func (p *Progress) Reset() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.totals = map[Stage]int{}
	p.done = map[Stage]int{}
	p.file = map[Stage]string{}
	p.cached = 0
	p.fresh = 0
	p.failures = nil
	p.stage = ""
	p.complete = false
}

// Finish marks the whole pass complete. The dashboard holds the last state,
// so a finished pass reads as a result rather than going blank.
func (p *Progress) Finish() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.complete = true
	e := p.event(p.stage)
	p.mu.Unlock()
	p.emit(e)
}

func (p *Progress) event(stage Stage) Event {
	e := Event{Stage: stage, Done: p.done[stage], Total: p.totals[stage], File: p.file[stage]}
	if f := p.lastFailure(stage); f != nil {
		e.Failed = f.Reason
	}
	return e
}

func (p *Progress) lastFailure(stage Stage) *Failure {
	for i := len(p.failures) - 1; i >= 0; i-- {
		if p.failures[i].Stage == stage {
			return &p.failures[i]
		}
	}
	return nil
}

// Snapshot copies the current state for anyone holding it past the run: the
// machine's poll payload, the dashboard's latest label.
func (p *Progress) Snapshot() State {
	if p == nil {
		return State{Complete: true}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	failures := make([]Failure, len(p.failures))
	copy(failures, p.failures)
	stages := make(map[Stage]StageState, len(Stages))
	for _, stage := range Stages {
		stages[stage] = StageState{Done: p.done[stage], Total: p.totals[stage]}
	}
	return State{
		Stage:    p.stage,
		Done:     p.done[p.stage],
		Total:    p.totals[p.stage],
		Stages:   stages,
		File:     p.file[p.stage],
		Cached:   p.cached,
		Fresh:    p.fresh,
		Failed:   len(p.failures),
		Failures: failures,
		Complete: p.complete,
	}
}

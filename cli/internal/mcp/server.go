// Package mcp exposes what the CLI already does — the index, the sandbox, the
// execution engine — to a model, over the Model Context Protocol. Every handler
// wraps something built elsewhere; nothing here decides anything about a run.
package mcp

import (
	"context"
	"errors"
	"fmt"
	"sync"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
)

// Backend is everything the tools reach that this package does not own. app
// implements it, which is what keeps the orchestrator out of the import graph
// and lets the handler tests run with no Docker and no project.
type Backend interface {
	// Index reads the project, and reports what changed since the last pass.
	Index(ctx context.Context) (*index.Snapshot, index.Delta, error)
	// Sandbox is the running copy of the project as it stands, or nil when none is
	// up. It never starts one, so a query cannot boot Docker as a side effect of
	// being asked.
	Sandbox() *sandbox.Stack
	// StartSandbox brings the run's own database, app and baseline up, and reports
	// what came up. Slow the first time, a no-op after that.
	StartSandbox(ctx context.Context) (Boot, error)
	// Compose reads the project's compose files, as compose itself resolves them.
	Compose(ctx context.Context) (*sandbox.Compose, error)
	// Environment is what has been worked out about the project's compose file, and
	// nil when nobody has: GritQA does not answer this for itself.
	Environment(ctx context.Context) (*sandbox.Environment, error)
	// Propose records an environment the agent worked out. It is pending until a
	// human approves it, and what comes back is the block that approves it: the
	// agent is talking to someone who would otherwise have to guess the shape.
	Propose(ctx context.Context, e sandbox.Environment) (accept string, err error)
	// RunPlan executes an approved plan, with repair and the state ledger wired
	// exactly as --plan wires them.
	RunPlan(ctx context.Context, p *plan.Plan) (*run.Result, error)
	Teardown(ctx context.Context) error
}

// Boot is what came up, reported back so an agent knows what it is querying and
// what the first call cost.
type Boot struct {
	Database string
	BaseURL  string
	Tables   []string
	Already  bool
}

type Options struct {
	Project string
	Root    string
	Backend Backend
	// Variables are the names run.variables declares, never their values. A plan
	// references one as {{name}} and the run resolves it; an agent that cannot see
	// the names invents a login instead.
	Variables []string
	// Execute mints an execute-scoped token as well as a read one. Off by
	// default: a local AI host gets the read set unless the user asked otherwise.
	Execute bool
	// Log goes to stderr. Stdout belongs to the protocol.
	Log func(string)
	// Printed asks for the lines a person needs to configure a client by hand:
	// the address and its bearer. Off when the bearer is handed over in process,
	// because then it is a credential on a screen for no reason.
	Printed bool
}

type Server struct {
	project string
	root    string
	back    Backend
	vars    []string
	log     func(string)
	keys    keyring
	// stdio is the scope a spawned server serves, since a subprocess carries no
	// bearer: spawning it is the authorization.
	stdio   Scope
	printed bool

	// addr is written by Serve on another goroutine and read by whoever
	// advertises it, so it is guarded. It empties when serving stops: an address
	// nothing listens on is worse than no address, because it is believed.
	mu    sync.RWMutex
	addr  string
	ready chan struct{}
	once  sync.Once
}

const version = "1"

func New(opts Options) (*Server, error) {
	if opts.Backend == nil {
		return nil, errors.New("an MCP server with no backend can do nothing")
	}
	if opts.Root == "" {
		return nil, errors.New("an MCP server needs a project root")
	}

	scopes := []Scope{Read}
	stdio := Read
	if opts.Execute {
		scopes = append(scopes, Execute)
		stdio = Execute
	}
	keys, err := newKeyring(scopes...)
	if err != nil {
		return nil, err
	}

	log := opts.Log
	if log == nil {
		log = func(string) {}
	}
	return &Server{
		project: opts.Project, root: opts.Root, back: opts.Backend,
		vars: opts.Variables,
		log:  log, keys: keys, stdio: stdio, printed: opts.Printed,
		ready: make(chan struct{}),
	}, nil
}

// build assembles a server holding only the tools this scope may reach. An
// execute tool at read scope is absent from tools/list, not refused on call.
func (s *Server) build(scope Scope) *sdk.Server {
	m := sdk.NewServer(&sdk.Implementation{Name: "gritqa", Version: version}, &sdk.ServerOptions{
		Instructions: fmt.Sprintf("Tools for the project %q on this developer's machine. "+
			"Reads run locally and cost nothing. %s", s.project, scopeNote(scope)),
		// The scope a session was opened at travels in its id, because after the
		// first request the SDK routes by session and would otherwise let a read
		// bearer reuse an execute session.
		GetSessionID: func() string { return session(scope) },
	})
	for _, t := range surface {
		if scope.allows(t.scope) {
			t.add(m, s)
		}
	}
	return m
}

func scopeNote(scope Scope) string {
	if scope == Execute {
		return "run_plan executes a plan a human has already approved; " +
			"it resets the sandbox to its post-seed baseline first, so research writes cannot make a step pass."
	}
	return "Nothing here has a side effect on the project: no tool writes a file, " +
		"and derive_environment only records a proposal for a human to approve."
}

// Tokens are what a client presents over HTTP, by scope. Empty for stdio.
func (s *Server) Tokens() map[Scope]string { return s.keys.tokens }

// Ready closes once Serve has bound a listener or failed trying, so a caller
// waiting for the address waits on the event rather than on a duration.
func (s *Server) Ready() <-chan struct{} { return s.ready }

// Live is the address to advertise, and whether there is still something behind
// it. False once serving has stopped, which is what stops a dead port being
// handed to the dashboard as somewhere to research.
func (s *Server) Live() (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.addr, s.addr != ""
}

// bound records the address and releases anyone waiting on Ready. Every exit from
// Serve calls it, so a server that never binds is a short wait rather than a hang.
func (s *Server) bound(addr string) {
	s.mu.Lock()
	s.addr = addr
	s.mu.Unlock()
	s.once.Do(func() { close(s.ready) })
}

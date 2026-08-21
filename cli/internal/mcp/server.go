// Package mcp exposes what the CLI already does — the index, the sandbox, the
// execution engine — to a model, over the Model Context Protocol. Every handler
// wraps something built elsewhere; nothing here decides anything about a run.
package mcp

import (
	"context"
	"errors"
	"fmt"

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
	// Sandbox is the sandbox as it stands, or nil when none is up. It never starts
	// one, so a query cannot boot Docker as a side effect of being asked.
	Sandbox() *sandbox.Sandbox
	// StartSandbox brings the run's own database, app and baseline up, and reports
	// what came up. Slow the first time, a no-op after that.
	StartSandbox(ctx context.Context) (Boot, error)
	// Recipe is how GritQA currently thinks this project boots.
	Recipe(ctx context.Context) (sandbox.Recipe, error)
	// Propose records a recipe the agent worked out. It is pending until a human
	// approves it, and no run boots on it before then.
	Propose(ctx context.Context, r sandbox.Recipe) error
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
	// Execute mints an execute-scoped token as well as a read one. Off by
	// default: a local AI host gets the read set unless the user asked otherwise.
	Execute bool
	// Log goes to stderr. Stdout belongs to the protocol.
	Log func(string)
}

type Server struct {
	project string
	root    string
	back    Backend
	log     func(string)
	keys    keyring
	// stdio is the scope a spawned server serves, since a subprocess carries no
	// bearer: spawning it is the authorization.
	stdio Scope
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
		log: log, keys: keys, stdio: stdio,
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

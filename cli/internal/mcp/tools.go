package mcp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-sql-driver/mysql"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/gritqa/cli/internal/index"
	"github.com/gritqa/cli/internal/plan"
	"github.com/gritqa/cli/internal/run"
	"github.com/gritqa/cli/internal/sandbox"
)

// surface is the whole tool set. The scope column is the security boundary, and
// build() reads it: this table is the one place to check what a read client can
// reach.
var surface = []struct {
	scope Scope
	add   func(*sdk.Server, *Server)
}{
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "get_index",
			Description: "What GritQA knows about this project: file count by language, the " +
				"HTTP endpoints it found and where each is registered, and what changed since " +
				"the last pass. Start here."}, s.getIndex)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "read_file",
			Description: "Read one file from the project, by repo-relative path. Host read, " +
				"bounded to the project directory and truncated at 128 KB."}, s.readFile)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "search",
			Description: "Find a literal string or a regular expression across the project's " +
				"source files, returning matching lines with their paths."}, s.search)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "describe_schema",
			Description: "Columns, types and keys of the sandbox database, which GritQA created " +
				"and migrated with the project's own tooling. No rows. First call brings the " +
				"sandbox up and can take a minute."}, s.describeSchema)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "db",
			Description: "Run one read-only query against the sandbox database. SELECT, SHOW, " +
				"EXPLAIN or DESCRIBE only, one statement. This is GritQA's own database, not " +
				"the developer's."}, s.db)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "derive_environment",
			Description: "Called empty, reports how GritQA currently thinks this project boots " +
				"and the Dockerfile that would build it. Called with a recipe, records yours as " +
				"a proposal for a human to approve — it does not take effect, and no run boots " +
				"on it until approved."}, s.deriveEnvironment)
	}},
	{Execute, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "run_plan",
			Description: "Execute an approved plan file against the sandbox. Resets to the " +
				"post-seed baseline first, so nothing research wrote can make a step pass. " +
				"The engine owns the verdict; a repaired step cannot loosen an assertion."}, s.runPlan)
	}},
	{Execute, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "snapshot",
			Description: "Take the sandbox's baseline: the state every later reading is measured " +
				"against, and what restore returns to."}, s.snapshot)
	}},
	{Execute, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "restore",
			Description: "Return the sandbox database to its baseline, dropping everything " +
				"written since."}, s.restore)
	}},
	{Execute, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "teardown",
			Description: "Remove the sandbox — database, app container, network and volumes. " +
				"The next tool that needs one brings a fresh one up."}, s.teardown)
	}},
}

const (
	maxRead     = 128 << 10 // the cap the model-read path already uses
	maxMatches  = 100
	maxRows     = 200
	maxEndpoint = 400
	clip        = 300
)

// get_index

type indexIn struct{}

type indexOut struct {
	Root       string         `json:"root"`
	Files      int            `json:"files"`
	Languages  map[string]int `json:"files_by_language"`
	Frameworks []string       `json:"frameworks,omitempty"`
	Source     string         `json:"endpoints_from"`
	Endpoints  []endpointOut  `json:"endpoints"`
	Omitted    int            `json:"endpoints_omitted,omitempty"`
	Unresolved int            `json:"registrations_unresolved,omitempty"`
	Changed    []string       `json:"changed_since_last_pass,omitempty"`
	First      bool           `json:"first_pass,omitempty"`
	Note       string         `json:"note,omitempty"`
}

type endpointOut struct {
	Method  string `json:"method,omitempty"`
	Path    string `json:"path"`
	File    string `json:"file"`
	Line    int    `json:"line,omitempty"`
	Handler string `json:"handler,omitempty"`
	Guarded bool   `json:"needs_auth,omitempty"`
}

func (s *Server) getIndex(ctx context.Context, _ *sdk.CallToolRequest, _ indexIn) (*sdk.CallToolResult, indexOut, error) {
	snap, delta, err := s.back.Index(ctx)
	if err != nil {
		return nil, indexOut{}, err
	}

	out := indexOut{
		Root:      s.root,
		Files:     len(snap.Files),
		Languages: map[string]int{},
		Source:    string(snap.Source),
		First:     delta.Empty() && len(snap.Files) > 0 && len(delta.Added) == 0,
	}
	if snap.SourceDetail != "" {
		out.Source += " (" + snap.SourceDetail + ")"
	}
	for _, f := range snap.Files {
		if f.Language != "" {
			out.Languages[f.Language]++
		}
	}
	for _, id := range snap.Frameworks {
		out.Frameworks = append(out.Frameworks, string(id))
	}
	out.Unresolved = snap.UnresolvedCount()

	for _, r := range snap.Routes {
		if len(out.Endpoints) == maxEndpoint {
			out.Omitted = len(snap.Routes) - maxEndpoint
			out.Note = fmt.Sprintf("%d more endpoints exist; narrow with search or read_file", out.Omitted)
			break
		}
		out.Endpoints = append(out.Endpoints, endpointOut{
			Method: r.Method, Path: r.Path, File: r.File, Line: r.Line,
			Handler: r.Handler, Guarded: len(r.Middleware) > 0,
		})
	}
	out.Changed = changed(delta)
	return nil, out, nil
}

func changed(d index.Delta) []string {
	var out []string
	for _, p := range d.Added {
		out = append(out, "added "+p)
	}
	for _, p := range d.Changed {
		out = append(out, "changed "+p)
	}
	for _, p := range d.Removed {
		out = append(out, "removed "+p)
	}
	return out
}

// read_file

type readIn struct {
	Path string `json:"path" jsonschema:"repo-relative path to the file"`
}

type readOut struct {
	Path      string `json:"path"`
	Language  string `json:"language,omitempty"`
	Bytes     int64  `json:"bytes"`
	Truncated bool   `json:"truncated,omitempty"`
	Content   string `json:"content"`
}

func (s *Server) readFile(_ context.Context, _ *sdk.CallToolRequest, in readIn) (*sdk.CallToolResult, readOut, error) {
	full, err := s.inProject(in.Path)
	if err != nil {
		return nil, readOut{}, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, readOut{}, fmt.Errorf("%s: %w", in.Path, err)
	}
	if info.IsDir() {
		return nil, readOut{}, fmt.Errorf("%s is a directory — use search or get_index", in.Path)
	}

	f, err := os.Open(full)
	if err != nil {
		return nil, readOut{}, err
	}
	defer f.Close()

	buf := make([]byte, maxRead)
	n, err := f.Read(buf)
	if err != nil && n == 0 && info.Size() > 0 {
		return nil, readOut{}, err
	}
	return nil, readOut{
		Path: filepath.ToSlash(in.Path), Language: index.Language(in.Path),
		Bytes: info.Size(), Truncated: info.Size() > int64(n), Content: string(buf[:n]),
	}, nil
}

// inProject resolves a repo-relative path and refuses anything outside the
// project, symlinks included. read_file is a host read, so this is the only
// boundary there is.
func (s *Server) inProject(rel string) (string, error) {
	if rel == "" {
		return "", errors.New("no path given")
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("%s is absolute — paths are relative to the project root", rel)
	}
	root, err := filepath.EvalSymlinks(s.root)
	if err != nil {
		return "", err
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	if resolved, err := filepath.EvalSymlinks(full); err == nil {
		full = resolved
	}
	within, err := filepath.Rel(root, full)
	if err != nil || within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside the project", rel)
	}
	return full, nil
}

// search

type searchIn struct {
	Query      string `json:"query" jsonschema:"literal string, or a Go regular expression when regex is true"`
	Regex      bool   `json:"regex,omitempty"`
	IgnoreCase bool   `json:"ignore_case,omitempty"`
	Path       string `json:"path,omitempty" jsonschema:"only search files whose path contains this"`
	Max        int    `json:"max,omitempty" jsonschema:"matches to return, default 100"`
}

type searchOut struct {
	Matches   []matchOut `json:"matches"`
	Files     int        `json:"files_searched"`
	Truncated bool       `json:"more_matches_exist,omitempty"`
}

type matchOut struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

func (s *Server) search(ctx context.Context, _ *sdk.CallToolRequest, in searchIn) (*sdk.CallToolResult, searchOut, error) {
	if strings.TrimSpace(in.Query) == "" {
		return nil, searchOut{}, errors.New("no query given")
	}
	limit := in.Max
	if limit <= 0 || limit > 5*maxMatches {
		limit = maxMatches
	}

	match, err := matcher(in)
	if err != nil {
		return nil, searchOut{}, err
	}

	paths, err := index.List(ctx, s.root)
	if err != nil {
		return nil, searchOut{}, err
	}

	out := searchOut{Matches: []matchOut{}}
	for _, p := range paths {
		if err := ctx.Err(); err != nil {
			return nil, out, err
		}
		if in.Path != "" && !strings.Contains(p, in.Path) {
			continue
		}
		body, err := os.ReadFile(filepath.Join(s.root, filepath.FromSlash(p)))
		if err != nil {
			continue
		}
		out.Files++
		for i, line := range strings.Split(string(body), "\n") {
			if !match(line) {
				continue
			}
			if len(out.Matches) == limit {
				out.Truncated = true
				return nil, out, nil
			}
			out.Matches = append(out.Matches, matchOut{
				Path: p, Line: i + 1, Text: clipped(strings.TrimRight(line, "\r")),
			})
		}
	}
	return nil, out, nil
}

func matcher(in searchIn) (func(string) bool, error) {
	if in.Regex {
		expr := in.Query
		if in.IgnoreCase {
			expr = "(?i)" + expr
		}
		re, err := regexp.Compile(expr)
		if err != nil {
			return nil, fmt.Errorf("that is not a valid regular expression: %w", err)
		}
		return re.MatchString, nil
	}
	if in.IgnoreCase {
		want := strings.ToLower(in.Query)
		return func(line string) bool { return strings.Contains(strings.ToLower(line), want) }, nil
	}
	return func(line string) bool { return strings.Contains(line, in.Query) }, nil
}

func clipped(s string) string {
	if len(s) <= clip {
		return s
	}
	return s[:clip] + "…"
}

// describe_schema

type schemaIn struct {
	Table string `json:"table,omitempty" jsonschema:"one table, or empty for all of them"`
}

type schemaOut struct {
	Database string          `json:"database"`
	Tables   []sandbox.Table `json:"tables"`
}

func (s *Server) describeSchema(ctx context.Context, _ *sdk.CallToolRequest, in schemaIn) (*sdk.CallToolResult, schemaOut, error) {
	box, err := s.back.Sandbox(ctx)
	if err != nil {
		return nil, schemaOut{}, err
	}
	tables, err := box.Schema(ctx, in.Table)
	if err != nil {
		return nil, schemaOut{}, err
	}
	if in.Table != "" && len(tables) == 0 {
		return nil, schemaOut{}, fmt.Errorf("no table called %s — call describe_schema with no argument to list them", in.Table)
	}
	return nil, schemaOut{Database: box.Env()["DB_NAME"], Tables: tables}, nil
}

// db

type dbIn struct {
	SQL string `json:"sql" jsonschema:"one read-only statement: SELECT, SHOW, EXPLAIN or DESCRIBE"`
	Max int    `json:"max,omitempty" jsonschema:"rows to return, default 200"`
}

type dbOut struct {
	Columns   []string `json:"columns"`
	Rows      [][]any  `json:"rows"`
	Truncated bool     `json:"more_rows_exist,omitempty"`
}

func (s *Server) db(ctx context.Context, _ *sdk.CallToolRequest, in dbIn) (*sdk.CallToolResult, dbOut, error) {
	stmt, err := readOnly(in.SQL)
	if err != nil {
		return nil, dbOut{}, err
	}
	limit := in.Max
	if limit <= 0 || limit > 5*maxRows {
		limit = maxRows
	}

	box, err := s.back.Sandbox(ctx)
	if err != nil {
		return nil, dbOut{}, err
	}

	// The real guard, because readOnly parses a verb and MySQL parses SQL: a
	// READ ONLY transaction refuses every write the server can see, including the
	// ones hiding behind a CTE. Rolled back either way, so nothing is held open
	// long enough to freeze another connection's watermark.
	tx, err := box.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, dbOut{}, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, stmt)
	if err != nil {
		return nil, dbOut{}, wrote(err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, dbOut{}, err
	}
	out := dbOut{Columns: cols, Rows: [][]any{}}
	for rows.Next() {
		if len(out.Rows) == limit {
			out.Truncated = true
			break
		}
		cells := make([]any, len(cols))
		into := make([]any, len(cols))
		for i := range cells {
			into[i] = &cells[i]
		}
		if err := rows.Scan(into...); err != nil {
			return nil, out, err
		}
		out.Rows = append(out.Rows, render(cells))
	}
	return nil, out, rows.Err()
}

// readOnly is the guard on db(sql). The database is GritQA's own, so this is not
// protecting the user's data — it is keeping research from writing rows that a
// later run would then pass on.
func readOnly(sql string) (string, error) {
	stmt := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(sql), ";"))
	if stmt == "" {
		return "", errors.New("no query given")
	}
	if strings.Contains(stmt, ";") {
		return "", errors.New("one statement at a time")
	}
	// OUTFILE and DUMPFILE write to the database server's own filesystem, which a
	// READ ONLY transaction does not cover.
	upper := strings.ToUpper(stmt)
	for _, out := range []string{"OUTFILE", "DUMPFILE"} {
		if strings.Contains(upper, out) {
			return "", fmt.Errorf("%s writes a file on the database server — db reads rows and "+
				"nothing else", out)
		}
	}
	verb := upper
	if i := strings.IndexAny(verb, " \t\n("); i > 0 {
		verb = verb[:i]
	}
	switch verb {
	case "SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "WITH", "TABLE", "VALUES":
		return stmt, nil
	}
	return "", fmt.Errorf("db is read-only, and %s is not — a plan is how writes happen, "+
		"and it goes through review first", verb)
}

// mysqlReadOnly is what the server answers when a statement would write inside a
// READ ONLY transaction. Reported in GritQA's own terms, because "Cannot execute
// statement" tells a model nothing about why.
const mysqlReadOnly = 1792

func wrote(err error) error {
	var my *mysql.MySQLError
	if errors.As(err, &my) && my.Number == mysqlReadOnly {
		return errors.New("that statement writes, and db reads — a plan is how writes happen, " +
			"and it goes through review first")
	}
	return err
}

func render(cells []any) []any {
	out := make([]any, len(cells))
	for i, c := range cells {
		switch v := c.(type) {
		case nil:
			out[i] = nil
		case []byte:
			out[i] = clipped(string(v))
		case string:
			out[i] = clipped(v)
		default:
			out[i] = v
		}
	}
	return out
}

// derive_environment

type envIn struct {
	Recipe *recipeIn `json:"recipe,omitempty" jsonschema:"the environment you worked out; omit to read the current one"`
	Why    string    `json:"why,omitempty" jsonschema:"what in the project led you to it"`
}

// recipeIn is what an agent may author, which is deliberately not sandbox.Recipe.
// Mount, the Dockerfile path, the author and the fingerprint are this machine's
// business, and leaving them out of the schema is what keeps a proposal from
// naming a directory outside the project.
type recipeIn struct {
	Base     string   `json:"base" jsonschema:"the image to build on, e.g. php:8.2-cli"`
	Packages []string `json:"packages,omitempty" jsonschema:"apt packages the runtime needs"`
	Setup    []string `json:"setup,omitempty" jsonschema:"build commands, e.g. docker-php-ext-install pdo_mysql"`
	Install  string   `json:"install,omitempty" jsonschema:"how dependencies are installed, e.g. composer install"`
	Serve    string   `json:"serve,omitempty" jsonschema:"how the app serves itself, using $PORT and $DOCROOT"`

	Workdir    string   `json:"workdir,omitempty" jsonschema:"where commands run, relative to the project"`
	Docroot    string   `json:"docroot,omitempty" jsonschema:"where the front controller is, relative to workdir"`
	Installdir string   `json:"installdir,omitempty" jsonschema:"where the manifest is, relative to the project"`
	Deps       string   `json:"deps,omitempty" jsonschema:"the dependency directory, e.g. vendor or node_modules"`
	Writable   []string `json:"writable,omitempty" jsonschema:"directories the app writes to, relative to workdir"`
}

func (r recipeIn) to() (sandbox.Recipe, error) {
	for _, p := range append([]string{r.Workdir, r.Docroot, r.Installdir, r.Deps}, r.Writable...) {
		if strings.Contains(filepath.ToSlash(p), "..") || filepath.IsAbs(p) {
			return sandbox.Recipe{}, fmt.Errorf("%q reaches outside the project — every path in a "+
				"recipe is relative to it", p)
		}
	}
	if strings.TrimSpace(r.Base) == "" {
		return sandbox.Recipe{}, errors.New("a recipe needs a base image")
	}
	return sandbox.Recipe{
		Base: r.Base, Packages: r.Packages, Setup: r.Setup, Install: r.Install, Serve: r.Serve,
		Workdir: r.Workdir, Docroot: r.Docroot, Installdir: r.Installdir, Deps: r.Deps,
		Writable: r.Writable, Author: sandbox.AuthorAgent,
	}, nil
}

type envOut struct {
	Author     string         `json:"author"`
	Current    sandbox.Recipe `json:"recipe"`
	Dockerfile string         `json:"dockerfile"`
	Proposed   bool           `json:"recorded_as_proposal,omitempty"`
	Note       string         `json:"note"`
}

func (s *Server) deriveEnvironment(ctx context.Context, _ *sdk.CallToolRequest, in envIn) (*sdk.CallToolResult, envOut, error) {
	current, err := s.back.Recipe(ctx)
	if err != nil {
		return nil, envOut{}, err
	}

	if in.Recipe == nil {
		body, err := current.Dockerfile()
		if err != nil {
			return nil, envOut{}, err
		}
		return nil, envOut{
			Author: current.Author, Current: current, Dockerfile: body,
			Note: "This is what a run would boot on today. " + describeAuthor(current.Author),
		}, nil
	}

	proposed, err := in.Recipe.to()
	if err != nil {
		return nil, envOut{}, err
	}
	proposed.Mount = current.Mount

	body, err := proposed.Dockerfile()
	if err != nil {
		return nil, envOut{}, fmt.Errorf("that recipe does not render: %w", err)
	}
	if err := s.back.Propose(ctx, proposed); err != nil {
		return nil, envOut{}, err
	}
	s.log("the agent proposed an environment: " + proposed.Base)
	return nil, envOut{
		Author: sandbox.AuthorAgent, Current: proposed, Dockerfile: body, Proposed: true,
		Note: "Recorded as a proposal. It is not in effect: runs keep booting on the " +
			describeAuthor(current.Author) + " recipe until a human approves this one.",
	}, nil
}

func describeAuthor(a string) string {
	switch a {
	case sandbox.AuthorConfig:
		return "the settings in .gritqa/config.yaml"
	case sandbox.AuthorDockerfile:
		return "a Dockerfile the project already has"
	case sandbox.AuthorAgent:
		return "an approved agent-derived"
	}
	return "GritQA's built-in table, which knows one row per language and nothing about frameworks"
}

// run_plan

type runIn struct {
	File string `json:"file" jsonschema:"repo-relative path to a plan JSON, usually under .gritqa/drafts/"`
}

type runOut struct {
	Plan    string     `json:"plan"`
	Status  string     `json:"status"`
	Passed  int        `json:"passed"`
	Steps   []stepOut  `json:"steps"`
	Moved   []movedOut `json:"what_moved,omitempty"`
	Repairs int        `json:"repairs,omitempty"`
	Elapsed int64      `json:"elapsed_ms"`
	Note    string     `json:"note,omitempty"`
}

type stepOut struct {
	Name    string     `json:"name"`
	Status  string     `json:"status"`
	Method  string     `json:"method,omitempty"`
	URL     string     `json:"url,omitempty"`
	Code    int        `json:"code,omitempty"`
	Elapsed int64      `json:"elapsed_ms"`
	Failed  []checkOut `json:"failed_checks,omitempty"`
	Err     string     `json:"error,omitempty"`
	Moved   []movedOut `json:"moved,omitempty"`
}

type movedOut struct {
	Unit string `json:"unit"`
	Rows int64  `json:"rows"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

func (s *Server) runPlan(ctx context.Context, _ *sdk.CallToolRequest, in runIn) (*sdk.CallToolResult, runOut, error) {
	// A path, never an inline plan. An agent has no tool that writes a file, so a
	// plan on disk is one that came through drafting and review — which is the
	// whole gate, and an inline body would walk straight around it.
	full, err := s.inProject(in.File)
	if err != nil {
		return nil, runOut{}, err
	}
	p, err := plan.Load(full)
	if err != nil {
		return nil, runOut{}, err
	}

	res, err := s.back.RunPlan(ctx, p)
	if err != nil {
		return nil, runOut{}, err
	}

	out := runOut{
		Plan: p.Name, Status: string(res.Status), Passed: res.Passed(),
		Repairs: res.Repairs, Elapsed: res.Elapsed.Milliseconds(),
		Moved: movedList(res.Moved), Note: res.StateErr,
	}
	for _, st := range res.Steps {
		out.Steps = append(out.Steps, stepOut{
			Name: st.Name, Status: string(st.Status), Method: st.Method, URL: st.URL,
			Code: st.Code, Elapsed: st.Elapsed.Milliseconds(), Failed: failed(st),
			Err: st.Err, Moved: movedList(st.Moved),
		})
	}
	return nil, out, nil
}

// checkOut is a failed assertion, in the engine's own terms. Structured rather
// than prose: a refine turn has to reason about what was expected against what
// arrived, not parse a sentence.
type checkOut struct {
	Asserted string `json:"asserted"`
	Target   string `json:"target,omitempty"`
	Operator string `json:"operator"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
	Missing  bool   `json:"target_absent,omitempty"`
}

func failed(s run.StepResult) []checkOut {
	var out []checkOut
	for _, c := range s.Checks {
		if c.Passed {
			continue
		}
		out = append(out, checkOut{
			Asserted: string(c.Type), Target: c.Target, Operator: string(c.Operator),
			Expected: c.Expected, Actual: c.Actual, Missing: !c.Found,
		})
	}
	return out
}

func movedList(ms []run.Moved) []movedOut {
	if len(ms) == 0 {
		return nil
	}
	out := make([]movedOut, len(ms))
	for i, m := range ms {
		out[i] = movedOut{Unit: m.Unit, Rows: m.Rows, From: m.From, To: m.To}
	}
	return out
}

// snapshot, restore, teardown

type emptyIn struct{}

type baselineOut struct {
	Tables int    `json:"tables"`
	Bytes  int64  `json:"bytes"`
	Note   string `json:"note,omitempty"`
}

func (s *Server) snapshot(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, baselineOut, error) {
	box, err := s.back.Sandbox(ctx)
	if err != nil {
		return nil, baselineOut{}, err
	}
	if err := box.Baseline(ctx); err != nil {
		return nil, baselineOut{}, err
	}
	return nil, baselineOut{Tables: len(box.Tables()), Bytes: box.BaselineBytes()}, nil
}

func (s *Server) restore(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, baselineOut, error) {
	box, err := s.back.Sandbox(ctx)
	if err != nil {
		return nil, baselineOut{}, err
	}
	if err := box.Reset(ctx); err != nil {
		return nil, baselineOut{}, err
	}
	return nil, baselineOut{
		Tables: len(box.Tables()), Bytes: box.BaselineBytes(),
		Note: "back at the baseline — everything written since is gone",
	}, nil
}

type teardownOut struct {
	Down bool   `json:"down"`
	Note string `json:"note"`
}

func (s *Server) teardown(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, teardownOut, error) {
	if err := s.back.Teardown(ctx); err != nil {
		return nil, teardownOut{}, err
	}
	s.log("the sandbox was torn down on request")
	return nil, teardownOut{Down: true,
		Note: "container, network and volumes removed; the next tool that needs a sandbox brings a fresh one up"}, nil
}

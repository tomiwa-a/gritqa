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
	"time"

	"github.com/go-sql-driver/mysql"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/gritqa/cli/internal/config"
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
				"the last pass. Start here.\n\n" +
				"plan_variables are the names the developer configured for a plan to reference " +
				"as {{name}} — a login, an admin password, whatever a guarded endpoint needs. " +
				"The values are resolved when the plan runs and are never shown to you. Use " +
				"these names; a credential you invent instead will fail every guarded step."}, s.getIndex)
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
		sdk.AddTool(m, &sdk.Tool{Name: "read_compose",
			Description: "The project's own Docker Compose file, as compose itself resolves it: " +
				"interpolation done, .env applied, overrides merged, every short form expanded, and " +
				"services behind a profile included and labelled. This is a straight read of what " +
				"the developer declared — nothing in it is interpreted.\n\n" +
				"Interpreting it is your job, and it is the whole job. Which service is the app, " +
				"which holds its data, which port serves HTTP, how the schema gets created, what " +
				"has to be neutralised before a second copy can run alongside theirs — none of " +
				"that is written down anywhere, and none of it is guessed for you. Work it out " +
				"from these services plus the code: read_file the Dockerfile a service builds " +
				"from, the manifest, the framework's config, whatever the commands reference. A " +
				"service gated behind a profile is a strong hint on its own, but a project may " +
				"declare no runner at all and do its migrating some other way, or have nothing to " +
				"migrate yet.\n\n" +
				"Values are reported as the file declares them. A value that came from .env or the " +
				"shell is shown as the ${...} expression it came from rather than what it resolved " +
				"to, because that one can be a live credential.\n\n" +
				"Costs nothing and starts nothing. Read this before start_sandbox, and record what " +
				"you concluded with derive_environment."}, s.readCompose)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "start_sandbox",
			Description: "Bring up GritQA's own copy of this project: a database it created and " +
				"migrated with the project's own tooling, and the app running against it. " +
				"Nothing of the developer's is touched. Slow the first time, and it is the only " +
				"thing that starts Docker — reach for it when reading source is not enough and " +
				"you need to query real data."}, s.startSandbox)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "db",
			Description: "Run one read-only query against the project's primary SQL datastore via the sandbox " +
				"(MySQL, Postgres, ClickHouse, etc.). If the sandbox is not yet running it will be started " +
				"automatically (about a minute the first time). One statement, and nothing that writes. " +
				"Use this for tables, schema, and data that lives in the project's own SQL store — " +
				"information_schema (or equivalent) describes what the project created, and you can make " +
				"multiple calls to join, filter, and cross-check. For non-SQL stores (MongoDB, Redis, " +
				"Kafka, etc.) this has no data to query — use search + read_file on the code instead."}, s.db)
	}},
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "derive_environment",
			Description: "Where your reading of read_compose gets written down. Called empty it " +
				"reports what is on record, which starts out as nothing at all — GritQA never " +
				"works this out for itself, so until you do it cannot bring a copy of the project " +
				"up.\n\n" +
				"What it wants is the handful of answers a compose file does not state: which " +
				"service answers HTTP and on which container port, which service holds the data " +
				"and what it speaks, how to connect to it, how the schema and its rows come up, " +
				"and which directories the app writes into. Every one of those is a conclusion " +
				"about a declaration — a service named web may be a proxy, a db may be a cache, " +
				"and a project may bring its schema up in a way nothing in compose mentions. Read " +
				"before you answer: the Dockerfile a service builds from, the manifest, the " +
				"framework's database config, the migration tool's own config. Leave a field out " +
				"rather than filling it with a guess.\n\n" +
				"Send credentials as names. $MYSQL_ROOT_PASSWORD means read that variable off that " +
				"service once the stack is up — GritQA resolves it at boot, so the password itself " +
				"never has to travel here. A literal is right for a fixed user like root.\n\n" +
				"What comes back is a check on shape only: that the services exist, that the paths " +
				"are container paths, that GritQA has a driver for what you named. Whether you " +
				"picked the right service is not checkable and is not checked. Recorded as a " +
				"proposal for a human to approve; nothing starts, and no run boots on it until " +
				"then."}, s.deriveEnvironment)
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
	{Read, func(m *sdk.Server, s *Server) {
		sdk.AddTool(m, &sdk.Tool{Name: "teardown",
			Description: "Remove the sandbox — database, app container, network and volumes. " +
				"Leaves nothing of GritQA's running on the machine."}, s.teardown)
	}},
}

const (
	maxRead     = 128 << 10 // the cap the model-read path already uses
	maxMatches  = 100
	maxRows     = 200
	maxEndpoint = 400
	clip        = 300
	maxStdout   = 4000
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
	Variables  []string       `json:"plan_variables,omitempty"`
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
	s.log(fmt.Sprintf("get_index: start root=%s", s.root))
	snap, delta, err := s.back.Index(ctx)
	if err != nil {
		s.log("get_index: error " + err.Error())
		return nil, indexOut{}, err
	}
	s.log(fmt.Sprintf("get_index: done %d files from %s", len(snap.Files), snap.Source))

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
	out.Variables = s.vars
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

func (s *Server) readFile(ctx context.Context, _ *sdk.CallToolRequest, in readIn) (*sdk.CallToolResult, readOut, error) {
	full, err := s.inProject(in.Path)
	if err != nil {
		return nil, readOut{}, err
	}
	if err := index.Readable(ctx, s.root, in.Path); err != nil {
		return nil, readOut{}, fmt.Errorf("%s: %w — get_index and search list what is readable", in.Path, err)
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
// project, symlinks included. read_file is a host read, so this and
// index.Readable are the whole boundary.
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

// tail is the last n bytes of what a command printed, which is the end a reader
// wants: a build says why it failed at the bottom, under the noise of it working
// up to that point. ToValidUTF8 because the cut can land mid-rune.
func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + strings.ToValidUTF8(s[len(s)-n:], "")
}

// start_sandbox

type startOut struct {
	Database string   `json:"database"`
	BaseURL  string   `json:"base_url"`
	Tables   []string `json:"tables"`
	Already  bool     `json:"already_running,omitempty"`
	Took     string   `json:"took"`
}

func (s *Server) startSandbox(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, startOut, error) {
	began := time.Now()
	boot, err := s.back.StartSandbox(ctx)
	if err != nil {
		return nil, startOut{}, err
	}
	return nil, startOut{
		Database: boot.Database, BaseURL: boot.BaseURL, Tables: boot.Tables, Already: boot.Already,
		Took: time.Since(began).Round(time.Millisecond).String(),
	}, nil
}

// live is the sandbox as it stands. Most tools require an explicit
// start_sandbox so a research turn never pays for a container it did not ask for.
// db is the exception — it auto-starts when nothing is running.
func (s *Server) live() (*sandbox.Stack, error) {
	st := s.back.Sandbox()
	if st == nil {
		return nil, errors.New("no sandbox is running — start_sandbox brings up a copy of the " +
			"project on its own compose file, and takes about a minute the first time")
	}
	return st, nil
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

	st, err := s.live()
	if err != nil {
		began := time.Now()
		s.log("db: no sandbox running, auto-starting for " + clipped(stmt))
		boot, serr := s.back.StartSandbox(ctx)
		if serr != nil {
			return nil, dbOut{}, fmt.Errorf("no sandbox was running and auto-start failed: %w", serr)
		}
		st = s.back.Sandbox()
		if st == nil {
			return nil, dbOut{}, errors.New("sandbox auto-start reported success but no sandbox is available")
		}
		s.log(fmt.Sprintf("db: sandbox up (%s, %d tables) in %s — already=%v",
			boot.Database, len(boot.Tables), time.Since(began).Round(time.Millisecond), boot.Already))
	}
	if st.DB() == nil {
		return nil, dbOut{}, errors.New("this build has no client for what this project's " +
			"datastore speaks, so there is no connection here to query it over — its own image " +
			"ships one, which a shell step reaches")
	}

	// The real guard, because readOnly parses a verb and MySQL parses SQL: a
	// READ ONLY transaction refuses every write the server can see, including the
	// ones hiding behind a CTE. Rolled back either way, so nothing is held open
	// long enough to freeze another connection's watermark.
	tx, err := st.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
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

// read_compose

type composeOut struct {
	Compose *sandbox.Compose `json:"compose"`
	Version string           `json:"compose_version,omitempty"`
	Note    string           `json:"note"`
}

func (s *Server) readCompose(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, composeOut, error) {
	got, err := s.back.Compose(ctx)
	if err != nil {
		return nil, composeOut{}, err
	}
	return nil, composeOut{
		Compose: got,
		Version: sandbox.ComposeVersion(ctx),
		Note: fmt.Sprintf("%d services as declared, nothing interpreted. Reading the files a "+
			"service builds from is usually the next thing worth doing.", len(got.Services)),
	}, nil
}

// derive_environment

type envIn struct {
	Environment *environmentIn `json:"environment,omitempty" jsonschema:"what you worked out; omit to read what is on record"`
	Why         string         `json:"why,omitempty" jsonschema:"what in the project led you to it"`
}

// environmentIn is what an agent may author, which is deliberately not
// sandbox.Environment: the author, the compose fingerprint and staleness are this
// machine's bookkeeping, not a judgement anyone can offer.
type environmentIn struct {
	App  string `json:"app" jsonschema:"the compose service that answers HTTP"`
	Port int    `json:"port" jsonschema:"the port inside that service's container that serves it"`

	Database string     `json:"database,omitempty" jsonschema:"the compose service holding the data a run should be measured against; omit if the project has none"`
	DBPort   int        `json:"db_port,omitempty" jsonschema:"the port it listens on inside its container"`
	Driver   string     `json:"driver,omitempty" jsonschema:"what it speaks, whatever that is: mysql, postgres, mongodb, redis, kafka. Name it even for a store GritQA has no client for — the project still boots, and the record is what says what the run was measured against"`
	Login    *loginIn   `json:"login,omitempty" jsonschema:"how to connect to it"`
	Schema   []schemaIn `json:"schema,omitempty" jsonschema:"how the schema and its data come up, in order; omit if nothing does"`

	Writable []string `json:"writable,omitempty" jsonschema:"absolute container paths the app writes to, e.g. /app/uploads"`
}

// loginIn takes keys, not values. A $KEY is read out of that service's
// environment when the stack is up, which is how a password reaches a connection
// without reaching this conversation.
type loginIn struct {
	User     string `json:"user,omitempty" jsonschema:"the user, literally, or $KEY to read it from the service's environment"`
	Password string `json:"password,omitempty" jsonschema:"$KEY naming the variable that carries it — send the name, never the password"`
	Name     string `json:"name,omitempty" jsonschema:"the database to connect to, literally or as $KEY"`
}

type schemaIn struct {
	Service string   `json:"service" jsonschema:"the compose service to run it in"`
	Run     []string `json:"run,omitempty" jsonschema:"the command, as argv; omit to run that service's own declared command"`
}

func (in environmentIn) to(why string) sandbox.Environment {
	out := sandbox.Environment{
		App: in.App, Port: in.Port,
		Database: in.Database, DBPort: in.DBPort, Driver: in.Driver,
		Writable: in.Writable, Author: sandbox.AuthorAgent, Why: why,
	}
	if in.Login != nil {
		out.Login = sandbox.Login{User: in.Login.User, Password: in.Login.Password, Name: in.Login.Name}
	}
	for _, s := range in.Schema {
		out.Schema = append(out.Schema, sandbox.SchemaStep{Service: s.Service, Run: s.Run})
	}
	return out
}

type envOut struct {
	Environment *sandbox.Environment `json:"environment"`
	Compose     string               `json:"compose_fingerprint,omitempty"`
	Stale       bool                 `json:"describes_an_older_compose_file,omitempty"`
	Proposed    bool                 `json:"recorded_as_proposal,omitempty"`
	// Accept is the config block that puts a proposal in effect. Nothing acts on
	// it here: it is what to show the human who has to approve it.
	Accept string `json:"accept_by_adding_to_config,omitempty"`
	Note   string `json:"note"`
}

func (s *Server) deriveEnvironment(ctx context.Context, _ *sdk.CallToolRequest, in envIn) (*sdk.CallToolResult, envOut, error) {
	got, err := s.back.Compose(ctx)
	if err != nil {
		return nil, envOut{}, err
	}

	if in.Environment == nil {
		current, err := s.back.Environment(ctx)
		if err != nil {
			return nil, envOut{}, err
		}
		out := envOut{Environment: current, Compose: got.Fingerprint}
		if current == nil {
			out.Note = "Nothing is on record. GritQA does not work this out for itself, so until " +
				"someone does, it cannot boot a copy of this project: read_compose, read what the " +
				"services build from and what their commands reference, then send your answer back here."
			return nil, out, nil
		}
		out.Stale = current.Stale(got)
		out.Note = "On record: " + current.Describe() + "."
		if out.Stale {
			out.Note += " The compose file has changed since this was worked out, so it may no " +
				"longer be right — check it against read_compose before trusting it."
		}
		return nil, out, nil
	}

	proposed := in.Environment.to(in.Why)
	proposed.Fingerprint = got.Fingerprint
	if err := proposed.Check(got); err != nil {
		return nil, envOut{}, err
	}
	accept, err := s.back.Propose(ctx, proposed)
	if err != nil {
		return nil, envOut{}, err
	}
	s.log("the agent worked out an environment: " + proposed.Describe())
	note := "Recorded as a proposal, and not in effect: no run boots on it until a human " +
		"approves it by adding accept_by_adding_to_config to " + config.Name +
		" — show them that block. Nothing was started."
	if proposed.Database != "" && !proposed.Watched() {
		note += fmt.Sprintf(" This build has no %s client, so a run will bring %s up and take no "+
			"readings of its own from it — the ledger will say so rather than imply the data was "+
			"watched. Query it with the client %s's own image ships.",
			proposed.Driver, proposed.Database, proposed.Database)
	}
	return nil, envOut{
		Environment: &proposed, Compose: got.Fingerprint, Proposed: true,
		Accept: accept, Note: note,
	}, nil
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
	Name   string `json:"name"`
	Status string `json:"status"`
	// Kind is omitted for http, so the shape a refine turn already reads is
	// unchanged for the steps that are still requests. URL carries the statement
	// or the command for the other two -- what actually ran, either way.
	Kind    string `json:"kind,omitempty"`
	Method  string `json:"method,omitempty"`
	URL     string `json:"url,omitempty"`
	Code    int    `json:"code,omitempty"`
	Elapsed int64  `json:"elapsed_ms"`
	// Rows is what a sql step's query came back with, or what its fixture moved.
	// Pointers, because zero rows is the answer a verification step exists to
	// catch and omitempty would drop it.
	Rows   *int64     `json:"rows,omitempty"`
	Exit   *int       `json:"exit_code,omitempty"`
	Output string     `json:"output,omitempty"`
	Failed []checkOut `json:"failed_checks,omitempty"`
	Err    string     `json:"error,omitempty"`
	Moved  []movedOut `json:"moved,omitempty"`
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
		row := stepOut{
			Name: st.Name, Status: string(st.Status), Method: st.Method, URL: st.URL,
			Code: st.Code, Elapsed: st.Elapsed.Milliseconds(), Failed: failed(st),
			Err: st.Err, Moved: movedList(st.Moved),
		}
		switch st.Kind {
		case plan.SQLStep:
			rows := st.RowsAffected
			row.Kind, row.Rows = string(plan.SQLStep), &rows
		case plan.ShellStep:
			code := st.ExitCode
			row.Kind, row.Exit, row.Output = string(plan.ShellStep), &code, tail(st.Stdout, maxStdout)
		}
		out.Steps = append(out.Steps, row)
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
	Note   string `json:"note,omitempty"`
}

func (s *Server) snapshot(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, baselineOut, error) {
	st, err := s.live()
	if err != nil {
		return nil, baselineOut{}, err
	}
	if err := st.Baseline(ctx); err != nil {
		return nil, baselineOut{}, err
	}
	return nil, baselineOut{Tables: len(st.Tables())}, nil
}

func (s *Server) restore(ctx context.Context, _ *sdk.CallToolRequest, _ emptyIn) (*sdk.CallToolResult, baselineOut, error) {
	st, err := s.live()
	if err != nil {
		return nil, baselineOut{}, err
	}
	if err := st.Reset(ctx); err != nil {
		return nil, baselineOut{}, err
	}
	return nil, baselineOut{
		Tables: len(st.Tables()),
		Note:   "back at the baseline — everything written since is gone",
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

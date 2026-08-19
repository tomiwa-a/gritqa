// Package config reads and writes .gritqa/config.yaml.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	Dir  = ".gritqa"
	Name = "config.yaml"
)

// Config is .gritqa/config.yaml. The first three fields are all that first run
// writes; Endpoints and Run are appended later, when discovery needs help and
// when a plan first needs executing.
type Config struct {
	Project   string     `yaml:"project"`
	Path      string     `yaml:"path"`
	Branch    string     `yaml:"branch"`
	Endpoints *Endpoints `yaml:"endpoints,omitempty"`
	Run       *Run       `yaml:"run,omitempty"`

	root string `yaml:"-"`
}

// Endpoints overrides how GritQA discovers the project's endpoints, for the
// projects it cannot read on its own.
type Endpoints struct {
	// List is the escape hatch: "GET /orders" lines, which win over everything.
	List []string `yaml:"list,omitempty"`
	// Spec points at an OpenAPI or Swagger document, when it is not somewhere
	// obvious.
	Spec string `yaml:"spec,omitempty"`
	// AI sends changed files to the server for extraction. Opt-in, because
	// unlike every other source it means source code leaves the machine.
	AI bool `yaml:"ai,omitempty"`
}

// EndpointOpts returns the discovery overrides, zeroed when none are set.
func (c *Config) EndpointOpts() Endpoints {
	if c.Endpoints == nil {
		return Endpoints{}
	}
	return *c.Endpoints
}

// Run describes how to bring the user's API up for a test run.
type Run struct {
	// Start launches the API. Empty means the user starts it themselves and
	// GritQA just calls BaseURL.
	Start   string            `yaml:"start"`
	Port    int               `yaml:"port"`
	BaseURL string            `yaml:"base_url,omitempty"`
	Ready   string            `yaml:"ready,omitempty"` // "GET /health"
	Migrate string            `yaml:"migrate,omitempty"`
	Seed    string            `yaml:"seed,omitempty"`
	Env     map[string]string `yaml:"env,omitempty"`
	// Variables are values a plan reads as {{name}}. A value of $NAME or ${NAME}
	// is read from the environment at run time, so an admin password is named
	// here and kept out of a file that gets committed.
	Variables map[string]string `yaml:"variables,omitempty"`
	Model     *Model            `yaml:"model,omitempty"`
	Repair    *Repair           `yaml:"repair,omitempty"`
}

// Repair bounds what a failed run may spend on the model. An unbounded agent
// loop against a live API is a runaway bill and an unexplainable run.
type Repair struct {
	// Attempts is how many fixes one failed step may be given.
	Attempts int `yaml:"attempts,omitempty"`
	// Budget is the total repair calls one run may make, however many steps fail.
	Budget int `yaml:"budget,omitempty"`
}

const (
	defaultRepairAttempts = 2
	defaultRepairBudget   = 8
)

// RepairOpts returns the repair bounds, defaulted. Zero is not "off": a run with
// no repairer never asks, and that is decided by whether a model is reachable.
func (r *Run) RepairOpts() Repair {
	out := Repair{Attempts: defaultRepairAttempts, Budget: defaultRepairBudget}
	if r == nil || r.Repair == nil {
		return out
	}
	if r.Repair.Attempts > 0 {
		out.Attempts = r.Repair.Attempts
	}
	if r.Repair.Budget > 0 {
		out.Budget = r.Repair.Budget
	}
	return out
}

// Model is the endpoint drafting talks to. It must speak the OpenAI chat
// completions API — Anthropic's own /v1/messages is not it, so reaching Claude
// means a compatibility proxy. No key ever lives here: GRITQA_API_KEY holds a
// static one, and TokenCommand mints a short-lived one.
type Model struct {
	Endpoint string `yaml:"endpoint"`
	Name     string `yaml:"name"`
	// TokenCommand prints a bearer on stdout. Vertex AI and anything else that
	// mints hour-long tokens needs this: a key exported once is stale by the
	// second run. It wins over GRITQA_API_KEY.
	TokenCommand string `yaml:"token_command,omitempty"`
	// TokenTTL is how long a minted token is reused, "45m" when unset. An
	// expired one is recovered from regardless, so this only saves calls.
	TokenTTL string `yaml:"token_ttl,omitempty"`
}

func (m Model) TTL() time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(m.TokenTTL))
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

const defaultModelEndpoint = "https://api.openai.com/v1"

// ModelOpts returns the drafting endpoint and model name as configured.
func (r *Run) ModelOpts() Model {
	if r == nil || r.Model == nil {
		return Model{Endpoint: defaultModelEndpoint}
	}
	out := *r.Model
	if out.Endpoint == "" {
		out.Endpoint = defaultModelEndpoint
	}
	out.Endpoint = strings.TrimRight(out.Endpoint, "/")
	return out
}

var ErrNotFound = errors.New("no .gritqa/config.yaml found")

// Find walks up from start looking for a project root: a directory holding
// .gritqa/config.yaml, or failing that one holding a recognised manifest.
func Find(start string) (root string, hasConfig bool, err error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", false, err
	}

	manifests := []string{"go.mod", "package.json", "requirements.txt", "pyproject.toml"}
	var firstManifest string

	for {
		if _, err := os.Stat(filepath.Join(dir, Dir, Name)); err == nil {
			return dir, true, nil
		}
		if firstManifest == "" {
			for _, m := range manifests {
				if _, err := os.Stat(filepath.Join(dir, m)); err == nil {
					firstManifest = dir
					break
				}
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	if firstManifest != "" {
		return firstManifest, false, nil
	}
	return "", false, ErrNotFound
}

func Load(root string) (*Config, error) {
	b, err := os.ReadFile(filepath.Join(root, Dir, Name))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	var c Config
	if err := yaml.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("%s is not valid YAML: %w", filepath.Join(Dir, Name), err)
	}
	if c.Project == "" {
		return nil, fmt.Errorf("%s has no project name", filepath.Join(Dir, Name))
	}
	c.root = root
	return &c, nil
}

// New builds the config first run writes: project name from the directory,
// path collapsed to ~ where possible, branch as given.
func New(root, branch string) *Config {
	return &Config{
		Project: filepath.Base(root),
		Path:    collapseHome(root),
		Branch:  branch,
		root:    root,
	}
}

func (c *Config) Root() string { return c.root }

// Save writes the config, creating .gritqa/ if needed.
func (c *Config) Save() error {
	dir := filepath.Join(c.root, Dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	b, err := yaml.Marshal(c)
	if err != nil {
		return err
	}

	tmp := filepath.Join(dir, Name+".tmp")
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, Name))
}

// CachePath is the SQLite index cache, alongside the config but gitignored.
func (c *Config) CachePath() string {
	return filepath.Join(c.root, Dir, "cache.db")
}

// DraftsPath holds the plans the model wrote, before a server exists to keep
// them.
func (c *Config) DraftsPath() string {
	return filepath.Join(c.root, Dir, "drafts")
}

// BaseURL is where test steps are pointed.
func (r *Run) ResolvedBaseURL() string {
	if r == nil {
		return ""
	}
	if r.BaseURL != "" {
		return strings.TrimRight(r.BaseURL, "/")
	}
	if r.Port > 0 {
		return fmt.Sprintf("http://localhost:%d", r.Port)
	}
	return ""
}

// Variables is run.variables resolved against the environment.
type Variables struct {
	// Values are what a plan reads as {{name}}.
	Values map[string]string
	// Secret names the ones that came from the environment. A value written into
	// the config file is committed already, so only these are worth masking.
	Secret []string
	// Missing names the ones whose environment variable is not set, and names
	// that variable too, because that is what the user has to fix.
	Missing []string
}

// ResolvedVariables reads run.variables, expanding a $NAME or ${NAME} value from
// the environment. A name whose variable is unset is reported rather than passed
// on empty, because an empty admin password fails every guarded step with a 401
// that explains nothing.
func (r *Run) ResolvedVariables() Variables {
	if r == nil || len(r.Variables) == 0 {
		return Variables{}
	}
	out := Variables{Values: make(map[string]string, len(r.Variables))}
	for name, v := range r.Variables {
		env, ok := envRef(v)
		if !ok {
			out.Values[name] = v
			continue
		}
		if got := os.Getenv(env); got != "" {
			out.Values[name], out.Secret = got, append(out.Secret, name)
			continue
		}
		out.Missing = append(out.Missing, fmt.Sprintf("%s ($%s)", name, env))
	}
	sort.Strings(out.Secret)
	sort.Strings(out.Missing)
	return out
}

// Secrets are the values to keep out of a transcript, a recorded run and a
// prompt. Short ones are left alone: a two-character value masked everywhere it
// occurs would shred every URL it appears inside.
func (v Variables) Secrets() []string {
	out := make([]string, 0, len(v.Secret))
	for _, name := range v.Secret {
		if s := v.Values[name]; len(s) >= minSecret {
			out = append(out, s)
		}
	}
	return out
}

const minSecret = 4

// VariableNames are the names a plan may reference, sorted. Names only: a value
// is a credential and belongs nowhere near a prompt or a drafted plan file.
func (r *Run) VariableNames() []string {
	if r == nil {
		return nil
	}
	out := make([]string, 0, len(r.Variables))
	for name := range r.Variables {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// envRef reads $NAME or ${NAME}, and only when that is the whole value: a body
// value with a $ somewhere in it is a literal, not a reference.
func envRef(v string) (string, bool) {
	name := strings.TrimSpace(v)
	if !strings.HasPrefix(name, "$") {
		return "", false
	}
	name = name[1:]
	if strings.HasPrefix(name, "{") && strings.HasSuffix(name, "}") {
		name = name[1 : len(name)-1]
	}
	if name == "" || strings.ContainsAny(name, " \t${}") {
		return "", false
	}
	return name, true
}

// ReadyProbe splits "GET /health" into its parts.
func (r *Run) ReadyProbe() (method, path string, ok bool) {
	if r == nil || r.Ready == "" {
		return "", "", false
	}
	parts := strings.Fields(r.Ready)
	switch len(parts) {
	case 1:
		return "GET", parts[0], true
	case 2:
		return strings.ToUpper(parts[0]), parts[1], true
	}
	return "", "", false
}

func collapseHome(p string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return p
	}
	if rel, err := filepath.Rel(home, p); err == nil && !strings.HasPrefix(rel, "..") {
		return filepath.Join("~", rel)
	}
	return p
}

// Expand resolves a leading ~ in a configured path.
func Expand(p string) string {
	if !strings.HasPrefix(p, "~") {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return p
	}
	return filepath.Join(home, strings.TrimPrefix(p, "~"))
}

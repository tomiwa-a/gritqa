// Package config reads and writes .gritqa/config.yaml.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

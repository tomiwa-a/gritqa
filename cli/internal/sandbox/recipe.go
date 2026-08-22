package sandbox

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Recipe is how to bring one project up. Whoever worked it out — the user, their
// own Dockerfile, the agent, or the built-in table — it is the same shape, so the
// agent becomes one more author rather than a second code path.
type Recipe struct {
	// File is the user's own Dockerfile. When set it is the whole recipe and every
	// field below except Workdir, Docroot and Writable is ignored.
	File string `json:"file,omitempty"`

	Base     string   `json:"base,omitempty"`
	Packages []string `json:"packages,omitempty"`
	Setup    []string `json:"setup,omitempty"`
	Install  string   `json:"install,omitempty"`
	Serve    string   `json:"serve,omitempty"`

	// Mount is the directory the container sees as /app, absolute on the host. It
	// has to cover everything the project's commands reach — a migration calling
	// ../vendor/bin/phinx puts it above the project root.
	Mount string `json:"mount"`
	// Workdir is where commands run, relative to Mount.
	Workdir string `json:"workdir,omitempty"`
	// Docroot holds the front controller, relative to Workdir.
	Docroot string `json:"docroot,omitempty"`
	// Installdir is where the package manager runs, relative to Mount. It is the
	// directory the manifest was found in, which is not always the project root.
	Installdir string `json:"installdir,omitempty"`
	// Deps is the dependency directory relative to Installdir, shadowed by a volume
	// when Install put its own copy in the image.
	Deps string `json:"deps,omitempty"`
	// Writable are directories the app may write to, relative to Workdir. Each
	// becomes a volume over the read-only source.
	Writable []string `json:"writable,omitempty"`

	// Author is config, dockerfile, agent or table — whichever filled Base.
	Author      string `json:"author"`
	Fingerprint string `json:"fingerprint,omitempty"`
}

const (
	AuthorConfig     = "config"
	AuthorDockerfile = "dockerfile"
	AuthorAgent      = "agent"
	AuthorTable      = "table"
)

// Recipe modes, as run.sandbox.recipe sets them.
const (
	Refresh = "refresh"
	Reuse   = "reuse"
	Always  = "always"
)

// Environment is DeriveRecipe with the cache policy applied. Under refresh a
// cached recipe whose fingerprint has moved no longer describes the project — a
// manifest or a lockfile changed — so it is dropped and the derivation taken
// again without it.
func Environment(in RecipeInput, mode string) (Recipe, error) {
	if mode == Always {
		in.Cached = nil
	}
	out, err := DeriveRecipe(in)
	if err != nil || in.Cached == nil || mode != Refresh {
		return out, err
	}
	if out.Fingerprint == in.Cached.Fingerprint {
		return out, nil
	}
	in.Cached = nil
	return DeriveRecipe(in)
}

// RecipeInput is what the authors have to work from.
type RecipeInput struct {
	// Root is the project root — where .gritqa lives.
	Root string
	// Language is the project's dominant language, by file extension.
	Language string
	// Config is what the user set, and wins field by field.
	Config Recipe
	// Cached is a recipe from a previous run, agent-authored or not. Nil skips it.
	Cached *Recipe
}

// DeriveRecipe fills a recipe from the highest-precedence author that has an
// answer for each field: the user's config, then their Dockerfile, then whatever
// the agent worked out last time, then the built-in table.
func DeriveRecipe(in RecipeInput) (Recipe, error) {
	out := in.Config
	out.Mount = resolveMount(in.Root, in.Config.Mount)
	if out.Workdir == "" {
		if rel, err := filepath.Rel(out.Mount, in.Root); err == nil && rel != "." {
			out.Workdir = filepath.ToSlash(rel)
		}
	}
	out.Author = AuthorConfig

	if out.File == "" && out.Base == "" {
		if path := filepath.Join(out.Mount, "Dockerfile"); exists(path) {
			out.File = path
			out.Author = AuthorDockerfile
		}
	}

	// The table is consulted only when nobody above it named a base image. A
	// recipe from the cache is a whole one, and an image the user named is theirs:
	// injecting docker-php-ext-install into it would break a build it owns.
	if out.File == "" {
		if in.Cached != nil {
			fill(&out, *in.Cached, in.Cached.Author)
		}
		if out.Base == "" {
			r, at, ok := pickRuntime(out.Mount, out.Workdir, in.Language)
			if !ok {
				return out, fmt.Errorf("nothing in %s says how to build an environment for this project — "+
					"GritQA knows %s, and needs run.sandbox.runtime or a Dockerfile for anything else",
					filepath.Join(out.Mount, out.Workdir), strings.Join(RuntimeLanguages(), ", "))
			}
			fill(&out, fromRuntime(r, at, out), AuthorTable)
		}
	}

	fp, err := fingerprint(out)
	if err != nil {
		return out, err
	}
	out.Fingerprint = fp
	return out, nil
}

// fromRuntime turns a table row into a recipe. Install is dropped when the host
// already holds the dependencies, because mounting them is cheaper than building
// them and the fingerprint then does not move on every lockfile touch.
func fromRuntime(r Runtime, at string, in Recipe) Recipe {
	out := Recipe{
		Base:       r.Base,
		Packages:   r.Packages,
		Setup:      r.Setup,
		Serve:      r.Serve,
		Deps:       r.Deps,
		Install:    r.Install,
		Installdir: at,
	}
	if r.Deps != "" && exists(filepath.Join(in.Mount, at, r.Deps)) {
		out.Install = ""
	}
	return out
}

// fill copies whatever from has and to has not, and credits from with authorship
// only if it supplied the base image.
func fill(to *Recipe, from Recipe, author string) {
	if to.Base == "" && from.Base != "" {
		to.Base, to.Author = from.Base, author
	}
	if len(to.Packages) == 0 {
		to.Packages = from.Packages
	}
	if len(to.Setup) == 0 {
		to.Setup = from.Setup
	}
	if to.Install == "" {
		to.Install = from.Install
	}
	if to.Serve == "" {
		to.Serve = from.Serve
	}
	if to.Deps == "" {
		to.Deps = from.Deps
	}
	if to.Installdir == "" {
		to.Installdir = from.Installdir
	}
	if to.Docroot == "" {
		to.Docroot = from.Docroot
	}
	if len(to.Writable) == 0 {
		to.Writable = from.Writable
	}
}

// MountRoot is the directory a container sees as the project. Exported because
// the compose lookup needs the same answer before any recipe exists.
func MountRoot(root, configured string) string { return resolveMount(root, configured) }

// resolveMount finds the dependency root. The git root is the default because it
// is where a project's manifests and its vendored dependencies sit, and a command
// reaching above the project root has to still resolve.
func resolveMount(root, configured string) string {
	if configured != "" {
		if filepath.IsAbs(configured) {
			return filepath.Clean(configured)
		}
		return filepath.Clean(filepath.Join(root, configured))
	}
	for dir := filepath.Clean(root); ; {
		if exists(filepath.Join(dir, ".git")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return filepath.Clean(root)
		}
		dir = parent
	}
}

// Dockerfile renders the recipe. It is what collapses a bare image, an image
// needing extensions, and a full dependency install into one path: produce a
// recipe, render it, build it.
func (r Recipe) Dockerfile() (string, error) {
	if r.File != "" {
		b, err := os.ReadFile(r.File)
		return string(b), err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "FROM %s\n", r.Base)
	if len(r.Packages) > 0 {
		fmt.Fprintf(&b, "RUN apt-get update && apt-get install -y --no-install-recommends %s"+
			" && rm -rf /var/lib/apt/lists/*\n", strings.Join(r.Packages, " "))
	}
	for _, line := range r.Setup {
		fmt.Fprintf(&b, "RUN %s\n", line)
	}

	if r.Install != "" {
		// Only the manifests are copied in, so the build context stays two small
		// files rather than the whole project.
		at := containerPath("/app", r.Installdir)
		fmt.Fprintf(&b, "WORKDIR %s\nCOPY . %s/\nRUN %s\n", at, at, r.Install)
	}
	fmt.Fprintf(&b, "WORKDIR %s\n", containerPath("/app", r.Workdir))
	return b.String(), nil
}

// envFiles are the files that define an environment. Source is deliberately not
// among them: editing a controller cannot change how the app boots, and hashing
// it would rebuild the image on every keystroke.
var envFiles = []string{
	"Dockerfile", ".dockerignore",
	"composer.json", "composer.lock",
	"package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
	"requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile", "Pipfile.lock",
	"go.mod", "go.sum",
	"Gemfile", "Gemfile.lock",
	"pom.xml", "build.gradle", "build.gradle.kts",
}

// fingerprint covers the recipe itself and the files that define the environment.
// A composer.json edit moves it; a controller edit does not.
func fingerprint(r Recipe) (string, error) {
	body, err := r.Dockerfile()
	if err != nil {
		return "", err
	}

	h := sha256.New()
	fmt.Fprintf(h, "recipe\x00%s\x00%s\x00%s\x00%s\x00%s\x00",
		body, r.Workdir, r.Docroot, r.Installdir, r.Deps)
	for _, dir := range []string{r.Mount, filepath.Join(r.Mount, r.Installdir), filepath.Join(r.Mount, r.Workdir)} {
		for _, name := range envFiles {
			sum, err := fileSum(filepath.Join(dir, name))
			if err != nil || sum == "" {
				continue
			}
			fmt.Fprintf(h, "%s\x00%s\x00", name, sum)
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:32], nil
}

func fileSum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", nil
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Encode and DecodeRecipe are how a recipe is persisted, and how the agent will
// hand one back.
func (r Recipe) Encode() (string, error) {
	b, err := json.Marshal(r)
	return string(b), err
}

func DecodeRecipe(s string) (*Recipe, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var r Recipe
	if err := json.Unmarshal([]byte(s), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// Describe is the one line the transcript prints about how this run was built.
func (r Recipe) Describe() string {
	what := r.Base
	if r.File != "" {
		what = "your own " + filepath.Base(r.File)
	}
	switch r.Author {
	case AuthorConfig:
		return what + ", as configured"
	case AuthorDockerfile:
		return what
	case AuthorAgent:
		return what + ", worked out by the agent"
	}
	return what
}

// depsPath is where the install landed inside the container, empty when there is
// nothing to shadow.
func (r Recipe) depsPath() string {
	if r.Install == "" || r.Deps == "" {
		return ""
	}
	return containerPath("/app", filepath.Join(r.Installdir, r.Deps))
}

// containerPath joins paths inside the container, which are slash-separated
// whatever the host is.
func containerPath(base, rel string) string {
	rel = strings.Trim(filepath.ToSlash(rel), "/")
	if rel == "" || rel == "." {
		return base
	}
	return base + "/" + rel
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

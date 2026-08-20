package sandbox

import "path/filepath"

// Runtime is what one language needs in order to run inside a container: which
// base image, which package manager, and where that manager puts its work.
//
// There is one row per language, and deliberately none per framework. Which
// framework a project uses, and how that framework is served, is not something a
// table can decide — there are too many, and a wrong guess costs more than no
// guess. That judgement belongs to the agent, which reads the project; this table
// only has to be enough to boot without one.
type Runtime struct {
	Language string
	// Manifest names the package manager by being present. Lock is hashed with it
	// so a dependency bump moves the fingerprint.
	Manifest string
	Lock     string
	Base     string
	Packages []string
	Setup    []string
	// Install is run at build time, and only when Deps is missing on the host.
	Install string
	// Deps is where the install lands, relative to the workdir. Empty means the
	// language installs globally and there is nothing to shadow.
	Deps string
	// Serve is filled for PHP alone, because php -S is a property of the language
	// rather than of a framework. Every other row leaves it empty and asks.
	Serve string
}

// serveCommand is PHP's built-in server. $PORT and $DOCROOT are set on the
// container, so any run.start may reference them the same way.
const serveCommand = `php -S 0.0.0.0:$PORT -t "$DOCROOT"`

var runtimes = []Runtime{
	{
		Language: "php",
		Manifest: "composer.json", Lock: "composer.lock",
		Base:     "php:8.2-cli",
		Packages: []string{"libzip-dev", "unzip"},
		// php:8.2-cli ships pdo_sqlite and mysqlnd but neither pdo_mysql nor
		// mysqli, so a bare image cannot reach the sandbox at all.
		Setup:   []string{"docker-php-ext-install pdo_mysql mysqli"},
		Install: "composer install --no-interaction --no-progress --prefer-dist",
		Deps:    "vendor",
		Serve:   serveCommand,
	},
	{
		Language: "javascript",
		Manifest: "package.json", Lock: "package-lock.json",
		Base:    "node:22-slim",
		Install: "npm ci --omit=dev",
		Deps:    "node_modules",
	},
	{
		Language: "typescript",
		Manifest: "package.json", Lock: "package-lock.json",
		Base:    "node:22-slim",
		Install: "npm ci",
		Deps:    "node_modules",
	},
	{
		Language: "python",
		Manifest: "requirements.txt",
		Base:     "python:3.12-slim",
		Install:  "pip install --no-cache-dir -r requirements.txt",
	},
	{
		Language: "ruby",
		Manifest: "Gemfile", Lock: "Gemfile.lock",
		Base:    "ruby:3.3-slim",
		Install: "bundle install",
	},
	{
		Language: "go",
		Manifest: "go.mod", Lock: "go.sum",
		Base:    "golang:1.23",
		Install: "go mod download",
	},
}

// pickRuntime matches on the manifest, which names a package manager rather than
// a framework. The project root is searched first and then the mount above it,
// because a repository can keep its composer.json and its vendor/ above the api/
// it serves. language breaks the one tie in the table, and comes from file
// extensions — the one thing about a project worth deciding without a model.
func pickRuntime(mount, workdir, language string) (Runtime, string, bool) {
	var (
		pick  Runtime
		at    string
		found bool
	)
	dirs := []string{""}
	if workdir != "" && workdir != "." {
		dirs = []string{workdir, ""}
	}
	for _, dir := range dirs {
		for _, r := range runtimes {
			if !exists(filepath.Join(mount, dir, r.Manifest)) {
				continue
			}
			if r.Language == language {
				return r, dir, true
			}
			if !found {
				pick, at, found = r, dir, true
			}
		}
	}
	return pick, at, found
}

// RuntimeLanguages is every language the table can boot with no model, for an
// error message that says what it does know.
func RuntimeLanguages() []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(runtimes))
	for _, r := range runtimes {
		if !seen[r.Language] {
			seen[r.Language] = true
			out = append(out, r.Language)
		}
	}
	return out
}

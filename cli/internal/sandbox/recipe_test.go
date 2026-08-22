package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// hotel is the shape that made Installdir necessary: composer.json, composer.lock
// and vendor/ at the git root, and the API served out of api/ below it.
func hotel(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{".git", "vendor", "api"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write(t, filepath.Join(root, "composer.json"), `{"require":{}}`)
	write(t, filepath.Join(root, "composer.lock"), `{"packages":[]}`)
	write(t, filepath.Join(root, "api", "index.php"), "<?php echo 1;")
	return root
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// The mount is the git root, so a migration calling ../vendor/bin/phinx resolves,
// and the manifest is found above the workdir rather than in it.
func TestTheRecipeFindsTheManifestAboveTheWorkdir(t *testing.T) {
	root := hotel(t)
	r, err := DeriveRecipe(RecipeInput{Root: filepath.Join(root, "api"), Language: "php"})
	if err != nil {
		t.Fatal(err)
	}

	if r.Mount != root {
		t.Errorf("mount = %s, want the git root %s", r.Mount, root)
	}
	if r.Workdir != "api" {
		t.Errorf("workdir = %q, want api", r.Workdir)
	}
	if r.Installdir != "" {
		t.Errorf("installdir = %q, want the mount root where composer.json is", r.Installdir)
	}
	if r.Base != "php:8.2-cli" || r.Author != AuthorTable {
		t.Errorf("got %s by %s, want the table's php row", r.Base, r.Author)
	}
	if r.Serve == "" {
		t.Error("php is the one language with a serve command of its own")
	}
	// vendor/ is already on the host, so mounting it beats building it.
	if r.Install != "" {
		t.Errorf("install = %q, want it dropped when the deps are already there", r.Install)
	}
	if got := r.depsPath(); got != "" {
		t.Errorf("depsPath = %q, want nothing to shadow", got)
	}
}

func TestTheRecipeInstallsWhenTheHostHasNoDeps(t *testing.T) {
	root := hotel(t)
	if err := os.RemoveAll(filepath.Join(root, "vendor")); err != nil {
		t.Fatal(err)
	}
	r, err := DeriveRecipe(RecipeInput{Root: filepath.Join(root, "api"), Language: "php"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(r.Install, "composer install") {
		t.Errorf("install = %q, want composer install", r.Install)
	}
	// The install ran at the mount root, so that is the path the volume shadows.
	if got := r.depsPath(); got != "/app/vendor" {
		t.Errorf("depsPath = %q, want /app/vendor", got)
	}
}

// package.json is the table's one tie, and the language breaks it.
func TestTheLanguageBreaksTheTablesOneTie(t *testing.T) {
	for _, tc := range []struct{ language, install string }{
		{"typescript", "npm ci"},
		{"javascript", "npm ci --omit=dev"},
	} {
		root := t.TempDir()
		write(t, filepath.Join(root, "package.json"), `{}`)
		r, err := DeriveRecipe(RecipeInput{Root: root, Language: tc.language})
		if err != nil {
			t.Fatal(err)
		}
		if r.Install != tc.install {
			t.Errorf("%s installs with %q, want %q", tc.language, r.Install, tc.install)
		}
		// No serve command outside PHP, on purpose: a wrong guess costs more than none.
		if r.Serve != "" {
			t.Errorf("%s was given a serve command: %q", tc.language, r.Serve)
		}
	}
}

func TestTheRecipeSaysWhatItKnowsWhenItCannotTell(t *testing.T) {
	_, err := DeriveRecipe(RecipeInput{Root: t.TempDir()})
	if err == nil {
		t.Fatal("a project with no manifest and no config was derived anyway")
	}
	for _, want := range []string{"php", "go", "run.sandbox.runtime"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not mention %q: %v", want, err)
		}
	}
}

// Each author fills only what the one above left blank.
func TestAuthorPrecedence(t *testing.T) {
	root := hotel(t)
	write(t, filepath.Join(root, "Dockerfile"), "FROM php:8.3-cli\n")
	api := filepath.Join(root, "api")

	// The table is the floor.
	table, err := DeriveRecipe(RecipeInput{Root: api, Language: "php", Config: Recipe{Mount: root}})
	if err != nil {
		t.Fatal(err)
	}
	if table.Author != AuthorDockerfile || table.File == "" {
		t.Fatalf("a Dockerfile at the mount root should be the recipe, got %s", table.Author)
	}

	// A cached recipe outranks the table, and the config outranks both — the
	// Dockerfile it names wins over the one found at the mount root.
	cached := &Recipe{Base: "php:8.1-cli", Author: AuthorAgent, Serve: "agent serve", Deps: "vendor"}
	mine := filepath.Join(root, "mine.Dockerfile")
	write(t, mine, "FROM php:8.2-cli\n")
	agent, err := DeriveRecipe(RecipeInput{
		Root: api, Language: "php", Cached: cached,
		Config: Recipe{Mount: root, File: mine},
	})
	if err != nil {
		t.Fatal(err)
	}
	if agent.File != mine {
		t.Errorf("config lost its Dockerfile to %q", agent.File)
	}

	os.Remove(filepath.Join(root, "Dockerfile"))
	agent, err = DeriveRecipe(RecipeInput{Root: api, Language: "php", Cached: cached})
	if err != nil {
		t.Fatal(err)
	}
	if agent.Base != "php:8.1-cli" || agent.Author != AuthorAgent {
		t.Errorf("got %s by %s, want the cached recipe", agent.Base, agent.Author)
	}
	if agent.Serve != "agent serve" || agent.Deps != "vendor" {
		t.Errorf("the cached recipe was not used whole: %+v", agent)
	}

	// Naming a base image means owning it: the table's php extension commands are
	// not injected into an image it did not choose.
	own, err := DeriveRecipe(RecipeInput{Root: api, Language: "php", Config: Recipe{Base: "ghcr.io/acme/api:3"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(own.Setup) != 0 || own.Serve != "" {
		t.Errorf("the table filled in behind a configured image: %+v", own)
	}

	// Config wins over everything, field by field.
	cfg, err := DeriveRecipe(RecipeInput{
		Root: api, Language: "php", Cached: cached,
		Config: Recipe{Base: "php:8.2-fpm", Serve: "my own command", Docroot: "public"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Base != "php:8.2-fpm" || cfg.Serve != "my own command" || cfg.Author != AuthorConfig {
		t.Errorf("config did not win: %+v", cfg)
	}
}

func TestDockerfileRendering(t *testing.T) {
	body, err := Recipe{
		Base:     "php:8.2-cli",
		Packages: []string{"libzip-dev", "unzip"},
		Setup:    []string{"docker-php-ext-install pdo_mysql"},
		Install:  "composer install",
		Workdir:  "api",
		Deps:     "vendor",
	}.Dockerfile()
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{
		"FROM php:8.2-cli\n",
		"apt-get install -y --no-install-recommends libzip-dev unzip",
		"RUN docker-php-ext-install pdo_mysql\n",
		"WORKDIR /app\nCOPY . /app/\nRUN composer install\n",
		"WORKDIR /app/api\n",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the Dockerfile is missing %q:\n%s", want, body)
		}
	}
	// The install runs where the manifest is; the app runs where the project is.
	if strings.Index(body, "RUN composer install") > strings.Index(body, "WORKDIR /app/api") {
		t.Errorf("the final workdir is not the project's:\n%s", body)
	}

	// A user's own Dockerfile is the whole recipe, read as written.
	dir := t.TempDir()
	path := filepath.Join(dir, "Dockerfile")
	write(t, path, "FROM scratch\n")
	if body, err = (Recipe{File: path, Base: "ignored"}).Dockerfile(); err != nil || body != "FROM scratch\n" {
		t.Errorf("Dockerfile() = %q, %v", body, err)
	}
}

// The fingerprint is what makes reuse cheap and correct: it moves when the
// environment's own files move, and stays put when the source does.
func TestTheFingerprintFollowsTheEnvironmentAndNotTheSource(t *testing.T) {
	root := hotel(t)
	api := filepath.Join(root, "api")
	in := RecipeInput{Root: api, Language: "php"}

	first, err := DeriveRecipe(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Fingerprint) != 32 {
		t.Errorf("fingerprint is %q", first.Fingerprint)
	}

	again, _ := DeriveRecipe(in)
	if again.Fingerprint != first.Fingerprint {
		t.Error("an untouched project fingerprinted differently twice")
	}

	write(t, filepath.Join(api, "index.php"), "<?php echo 2; // a controller edit")
	source, _ := DeriveRecipe(in)
	if source.Fingerprint != first.Fingerprint {
		t.Error("editing a controller rebuilt the image, which it cannot have changed")
	}

	write(t, filepath.Join(root, "composer.json"), `{"require":{"vlucas/phpdotenv":"^5"}}`)
	dep, _ := DeriveRecipe(in)
	if dep.Fingerprint == first.Fingerprint {
		t.Error("editing composer.json did not move the fingerprint")
	}
}

// Environment applies the cache policy. refresh drops a cached recipe whose
// fingerprint has moved; reuse keeps it; always never looks at it.
func TestRecipeModes(t *testing.T) {
	root := hotel(t)
	in := RecipeInput{
		Root: filepath.Join(root, "api"), Language: "php",
		Cached: &Recipe{Base: "php:8.1-cli", Author: AuthorAgent, Fingerprint: "stale"},
	}

	fresh, err := RecipeFor(in, Refresh)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Author != AuthorTable || fresh.Base != "php:8.2-cli" {
		t.Errorf("refresh kept a stale recipe: %s by %s", fresh.Base, fresh.Author)
	}

	kept, err := RecipeFor(in, Reuse)
	if err != nil {
		t.Fatal(err)
	}
	if kept.Base != "php:8.1-cli" {
		t.Errorf("reuse re-derived anyway: %s", kept.Base)
	}

	// And refresh keeps it once the fingerprint agrees.
	in.Cached.Fingerprint = kept.Fingerprint
	if got, _ := RecipeFor(in, Refresh); got.Base != "php:8.1-cli" {
		t.Errorf("refresh dropped a recipe that still describes the project: %s", got.Base)
	}
	if got, _ := RecipeFor(in, Always); got.Base != "php:8.2-cli" {
		t.Errorf("always used the cache: %s", got.Base)
	}
}

func TestRecipeRoundTrips(t *testing.T) {
	want := Recipe{Base: "php:8.2-cli", Mount: "/x", Workdir: "api", Writable: []string{"uploads"},
		Author: AuthorAgent, Fingerprint: "abc"}
	body, err := want.Encode()
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeRecipe(body)
	if err != nil {
		t.Fatal(err)
	}
	if got.Base != want.Base || got.Author != want.Author || len(got.Writable) != 1 {
		t.Errorf("round trip lost something: %+v", got)
	}
	if empty, err := DecodeRecipe("  "); empty != nil || err != nil {
		t.Errorf("DecodeRecipe(blank) = %v, %v", empty, err)
	}
	if !strings.Contains(want.Describe(), "agent") {
		t.Errorf("Describe() = %q, want it to say who decided", want.Describe())
	}
}

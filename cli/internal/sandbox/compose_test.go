package sandbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The shape docker compose config emits: every short form already expanded, a
// null environment value for a name passed through from the shell, and a
// profiled service present but labelled.
const resolved = `{
  "name": "shop",
  "services": {
    "web": {
      "build": {"context": "/src", "dockerfile": "Dockerfile"},
      "command": ["node", "server.js"],
      "working_dir": "/app",
      "environment": {"DATABASE_URL": "postgres://db/shop", "STRIPE_KEY": null},
      "ports": [{"target": 3000, "published": "3000", "protocol": "tcp"},
                {"target": 9229, "protocol": "tcp"}],
      "volumes": [{"type": "bind", "source": "/src", "target": "/app"},
                  {"type": "volume", "source": "uploads", "target": "/app/uploads"}],
      "depends_on": {"cache": {"condition": "service_started", "required": true},
                     "db": {"condition": "service_healthy", "required": true}}
    },
    "db": {
      "image": "postgres:16",
      "environment": {"POSTGRES_PASSWORD": "dev"},
      "volumes": [{"type": "volume", "source": "pgdata", "target": "/var/lib/postgresql/data"}],
      "healthcheck": {"test": ["CMD", "pg_isready"], "retries": 20}
    },
    "cache": {"image": "redis:7", "healthcheck": {"test": ["CMD", "redis-cli", "ping"], "disable": true}},
    "migrate": {
      "image": "shop-tools",
      "command": ["npm", "run", "migrate"],
      "profiles": ["tools"]
    }
  },
  "volumes": {"pgdata": {"name": "shop_pgdata"}, "uploads": {"name": "shop_uploads"}}
}`

func TestParseComposeReportsWhatTheFileDeclares(t *testing.T) {
	c, err := parseCompose([]byte(resolved))
	if err != nil {
		t.Fatal(err)
	}

	if c.Name != "shop" {
		t.Errorf("name = %q", c.Name)
	}
	// Sorted, so two reads of one file report the same thing.
	var names []string
	for _, s := range c.Services {
		names = append(names, s.Name)
	}
	if got := names; len(got) != 4 || got[0] != "cache" || got[1] != "db" || got[2] != "migrate" || got[3] != "web" {
		t.Fatalf("services = %v, want them sorted", got)
	}
	if len(c.Volumes) != 2 || c.Volumes[0] != "pgdata" {
		t.Errorf("volumes = %v", c.Volumes)
	}
	if len(c.Profiles) != 1 || c.Profiles[0] != "tools" {
		t.Errorf("profiles = %v", c.Profiles)
	}

	web, _ := c.Service("web")
	if web.Build != "/src" || web.Dockerfile != "Dockerfile" || web.Image != "" {
		t.Errorf("web builds rather than pulls: %+v", web)
	}
	if len(web.Command) != 2 || web.WorkingDir != "/app" {
		t.Errorf("web command/workdir: %+v", web)
	}
	// A pass-through name is declared, which is the fact worth reporting; its
	// value is not in the file.
	if v, ok := web.Environment["STRIPE_KEY"]; !ok || v != "" {
		t.Errorf("STRIPE_KEY = %q, %v", v, ok)
	}
	if web.Environment["DATABASE_URL"] != "postgres://db/shop" {
		t.Errorf("env = %v", web.Environment)
	}
	// An unpublished port is still a port. Only the published one collides.
	if len(web.Ports) != 2 || web.Ports[0].Published != "3000" || web.Ports[1].Published != "" {
		t.Errorf("ports = %+v", web.Ports)
	}
	if len(web.Mounts) != 2 || web.Mounts[0].Kind != "bind" || web.Mounts[1].Kind != "volume" {
		t.Errorf("mounts = %+v", web.Mounts)
	}
	if len(web.DependsOn) != 2 || web.DependsOn[0].Service != "cache" ||
		web.DependsOn[1].Condition != "service_healthy" {
		t.Errorf("depends_on = %+v", web.DependsOn)
	}

	db, _ := c.Service("db")
	if db.Image != "postgres:16" || len(db.Healthcheck) != 2 {
		t.Errorf("db = %+v", db)
	}
	// A disabled healthcheck is no healthcheck, so nothing can wait on it.
	if cache, _ := c.Service("cache"); cache.Healthcheck != nil {
		t.Errorf("a disabled healthcheck should not be reported: %+v", cache.Healthcheck)
	}

	migrate, _ := c.Service("migrate")
	if !migrate.Gated() {
		t.Error("a profiled service is gated, and that is why it is worth reporting")
	}
	if web, _ := c.Service("web"); web.Gated() {
		t.Error("web is not gated")
	}
	if _, ok := c.Service("nothing"); ok {
		t.Error("a miss is a miss")
	}
}

func TestParseComposeRejectsWhatIsNotADocument(t *testing.T) {
	if _, err := parseCompose([]byte("not json")); err == nil {
		t.Fatal("want an error")
	}
}

// The document alone cannot see a Dockerfile edit: the compose file is unchanged
// and the image it builds is not.
func TestComposeFingerprintCoversTheDockerfile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Dockerfile")
	if err := os.WriteFile(path, []byte("FROM node:22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := []Service{{Name: "web", Build: dir, Dockerfile: "Dockerfile"}}
	doc := []byte(`{"name":"shop"}`)

	first, err := composeFingerprint(doc, svc)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := composeFingerprint(doc, svc); again != first {
		t.Fatal("an unchanged environment has to fingerprint the same")
	}

	if err := os.WriteFile(path, []byte("FROM node:22\nRUN npm i -g pnpm\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	after, err := composeFingerprint(doc, svc)
	if err != nil {
		t.Fatal(err)
	}
	if after == first {
		t.Error("editing the Dockerfile has to move the fingerprint")
	}

	// And a service that pulls has no Dockerfile to miss.
	if _, err := composeFingerprint(doc, []Service{{Name: "db", Image: "postgres:16"}}); err != nil {
		t.Fatal(err)
	}
}

func TestFindComposeFollowsComposesOwnOrder(t *testing.T) {
	dir := t.TempDir()
	if got := FindCompose(dir); got != nil {
		t.Fatalf("nothing there, got %v", got)
	}
	for _, name := range []string{"docker-compose.yml", "compose.yaml"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("services: {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := FindCompose(dir)
	if len(got) != 1 || filepath.Base(got[0]) != "compose.yaml" {
		t.Fatalf("got %v, want compose.yaml to win", got)
	}
}

// The exec path, against real compose: interpolation from .env, a short-form
// port, a short-form volume and a profile all come back expanded.
func TestReadComposeGoesThroughCompose(t *testing.T) {
	ctx := live(t)
	dir := t.TempDir()

	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(".env", "TAG=16-alpine\nHOSTPORT=15432\n")
	write("compose.yml", `
name: readtest
services:
  api:
    image: alpine:3
    command: sleep 1
    ports: ["${HOSTPORT}:5432"]
    volumes: [".:/src:ro"]
    depends_on: [store]
  store:
    image: postgres:${TAG}
    environment:
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD", "pg_isready"]
  seeder:
    image: alpine:3
    profiles: [tools]
    command: sh -c 'echo seeded'
`)

	c, err := ReadCompose(ctx, FindCompose(dir))
	if err != nil {
		t.Fatal(err)
	}
	if c.Name != "readtest" || len(c.Services) != 3 {
		t.Fatalf("got %q with %d services", c.Name, len(c.Services))
	}
	if c.Fingerprint == "" {
		t.Error("a document with no build still fingerprints")
	}

	store, _ := c.Service("store")
	if store.Image != "postgres:16-alpine" {
		t.Errorf("interpolation is compose's job: image = %q", store.Image)
	}
	api, _ := c.Service("api")
	if len(api.Ports) != 1 || api.Ports[0].Published != "15432" || api.Ports[0].Container != 5432 {
		t.Errorf("ports = %+v", api.Ports)
	}
	if len(api.Mounts) != 1 || api.Mounts[0].Kind != "bind" || !api.Mounts[0].ReadOnly {
		t.Errorf("mounts = %+v", api.Mounts)
	}
	if len(api.DependsOn) != 1 || api.DependsOn[0].Service != "store" {
		t.Errorf("depends_on = %+v", api.DependsOn)
	}
	if seeder, _ := c.Service("seeder"); !seeder.Gated() {
		t.Error("a profiled service has to be reported, and reported as gated")
	}
}

// A file compose itself rejects is the developer's to fix, so its own message is
// what comes back.
func TestReadComposeHandsBackComposesOwnComplaint(t *testing.T) {
	ctx := live(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "compose.yml"),
		[]byte("services:\n  api:\n    image: alpine:3\n    ports: nonsense\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := ReadCompose(ctx, FindCompose(dir))
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "ports") {
		t.Errorf("compose named the field; we should not bury it: %v", err)
	}
}

// The disclosure rule: a value typed into the file is already in the developer's
// repository, and one that arrived from .env, the shell or an env_file is not
// ours to report. The name and where it comes from still are.
func TestReadComposeKeepsSecretsOutOfWhatItReports(t *testing.T) {
	ctx := live(t)
	dir := t.TempDir()

	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(".env", "PROD_PW=sk-live-must-not-appear\nTAG=3\n")
	write("api.env", "SESSION_SECRET=also-must-not-appear\n")
	write("compose.yml", `
name: disclose
services:
  api:
    image: alpine:${TAG}
    env_file: [api.env]
    command: ["sh", "-c", "echo ${PROD_PW}"]
    environment:
      DB_HOST: db
      DB_PASSWORD: ${PROD_PW}
  db:
    image: alpine:3
`)

	c, err := ReadCompose(ctx, FindCompose(dir))
	if err != nil {
		t.Fatal(err)
	}
	api, _ := c.Service("api")

	// The signal survives: a literal is a literal.
	if api.Environment["DB_HOST"] != "db" {
		t.Errorf("a literal is already committed, so it stays: %q", api.Environment["DB_HOST"])
	}
	// The expression is reported rather than the value, so the AI knows the name
	// is set and where it comes from.
	if got := api.Environment["DB_PASSWORD"]; got != "${PROD_PW}" {
		t.Errorf("DB_PASSWORD = %q, want the expression", got)
	}
	if got, ok := api.Environment["SESSION_SECRET"]; !ok || got != "<from env_file>" {
		t.Errorf("SESSION_SECRET = %q, %v", got, ok)
	}
	if len(api.Command) != 3 || api.Command[2] != "echo ${PROD_PW}" {
		t.Errorf("an interpolated command keeps the expression: %v", api.Command)
	}
	// Image tags are not credentials and the AI needs the real one.
	if api.Image != "alpine:3" {
		t.Errorf("image = %q, want it resolved", api.Image)
	}

	whole, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"sk-live-must-not-appear", "also-must-not-appear"} {
		if strings.Contains(string(whole), secret) {
			t.Errorf("%q reached what gets reported", secret)
		}
	}
}

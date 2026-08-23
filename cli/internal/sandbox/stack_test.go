package sandbox

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectNameIsSomethingComposeAccepts(t *testing.T) {
	cases := []struct{ name, fingerprint, want string }{
		{"hotel-api", "9f2c1188aa", "gritqa-hotel-api-9f2c1188"},
		{"Hotel API", "abcd", "gritqa-hotel-api-abcd"},
		{"", "abcd", "gritqa-project-abcd"},
		{"--", "abcd", "gritqa-project-abcd"},
		{strings.Repeat("x", 40), "abcd", "gritqa-" + strings.Repeat("x", 24) + "-abcd"},
	}
	for _, c := range cases {
		got := projectName(c.name, c.fingerprint)
		if got != c.want {
			t.Errorf("projectName(%q, %q) = %q, want %q", c.name, c.fingerprint, got, c.want)
		}
		for _, r := range got {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				t.Errorf("projectName(%q) = %q, which compose will not take", c.name, got)
			}
		}
	}
}

// The whole seam, live: a project GritQA was told nothing about beyond which
// service is which, booted from its own compose file, with a schema step behind a
// profile, a credential that only exists in .env, and an upload that must not
// reach the developer's tree.
func TestLaunchBootsACopyAndNotTheOriginal(t *testing.T) {
	ctx := live(t)
	dir := t.TempDir()
	write(t, filepath.Join(dir, ".env"), "PW=fixture-only-password\n")
	write(t, filepath.Join(dir, "www", "index.html"), "<h1>shop</h1>\n")
	write(t, filepath.Join(dir, "www", "uploads", "theirs.txt"), "the developer's file\n")
	write(t, filepath.Join(dir, "compose.yml"), `
name: shopfixture
services:
  web:
    image: alpine:latest
    command: ["sh", "-c", "while true; do { printf 'HTTP/1.1 200 OK\r\nContent-Length: %s\r\n\r\n' $$(wc -c </www/index.html); cat /www/index.html; } | nc -l -p 8080; done"]
    ports: ["8099:8080"]
    volumes:
      - ./www:/www
  store:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${PW}
      POSTGRES_USER: shop
      POSTGRES_DB: shop
    ports: ["5439:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shop -d shop"]
      interval: 2s
      retries: 30
  migrate:
    image: postgres:16
    profiles: [tools]
    environment:
      PGPASSWORD: ${PW}
    command: ["psql", "-h", "store", "-U", "shop", "-d", "shop", "-c",
              "CREATE TABLE rooms (id serial primary key)"]
    depends_on:
      store:
        condition: service_healthy
volumes:
  pgdata:
`)

	c, err := ReadCompose(ctx, []string{filepath.Join(dir, "compose.yml")})
	if err != nil {
		t.Fatalf("ReadCompose: %v", err)
	}
	// What the file itself says, not what .env resolved to: the report masks a
	// value that arrived from outside the repository.
	if store, _ := c.Service("store"); store.Environment["POSTGRES_PASSWORD"] != "${PW}" {
		t.Fatalf("the read leaked the password: %q", store.Environment["POSTGRES_PASSWORD"])
	}

	e := Environment{
		App: "web", Port: 8080,
		Database: "store", DBPort: 5432, Driver: "postgres",
		Login:    Login{User: "$POSTGRES_USER", Password: "$POSTGRES_PASSWORD", Name: "$POSTGRES_DB"},
		Schema:   []SchemaStep{{Service: "migrate"}},
		Writable: []string{"/www/uploads"},
		Author:   AuthorAgent,
	}

	var progress []string
	st, err := Launch(ctx, LaunchOptions{
		Compose: c, Environment: e, Name: "shop",
		OnProgress: func(s string) { progress = append(progress, s) },
	})
	if err != nil {
		t.Fatalf("Launch: %v", err)
	}
	t.Cleanup(func() { st.Down(t.Context()) })

	// The generated document carries the developer's password, because compose
	// resolved ${PW} to write it. It is 0600 in GritQA's own directory, never in
	// their tree, and it does not outlive the run.
	const pw = "fixture-only-password"
	generated, stackDir := st.files[0], st.dir
	doc, err := os.ReadFile(generated)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(doc), pw) {
		t.Error("the generated document carries no credential, so this asserts nothing")
	}
	if filepath.Dir(generated) != stackDir || strings.HasPrefix(generated, dir) {
		t.Errorf("the generated document is at %s", generated)
	}
	info, err := os.Stat(generated)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("the generated document is %o, want 600", mode)
	}
	if got := st.Secrets(); len(got) != 1 || got[0] != pw {
		t.Errorf("Secrets() = %v, want the value a step's report is masked against", got)
	}

	// Nothing of the original's is reused, starting with the ports it declares.
	if st.appPort == 8099 || st.dbPort == 5439 {
		t.Errorf("the copy took the original's ports: app %d db %d", st.appPort, st.dbPort)
	}
	if !strings.Contains(strings.Join(progress, "\n"), "not publishing web 8099") {
		t.Errorf("nothing said the fixed port was dropped: %v", progress)
	}

	res, err := http.Get(st.BaseURL())
	if err != nil {
		t.Fatalf("GET %s: %v", st.BaseURL(), err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("GET %s = %d", st.BaseURL(), res.StatusCode)
	}

	// The login named keys rather than values, and the password never left .env.
	if st.Database() != "shop" {
		t.Errorf("database = %q, want shop resolved out of $POSTGRES_DB", st.Database())
	}
	if err := st.DB().PingContext(ctx); err != nil {
		t.Fatalf("the copy's database will not answer: %v", err)
	}

	// The schema step is gated behind a profile, so a boot that did not ask for
	// every profile would report no such service.
	if err := st.Schema(ctx); err != nil {
		t.Fatalf("Schema: %v", err)
	}
	var tables int
	if err := st.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM information_schema.tables WHERE table_name = 'rooms'`).Scan(&tables); err != nil {
		t.Fatalf("counting tables: %v", err)
	}
	if tables != 1 {
		t.Errorf("the schema step ran and rooms does not exist")
	}

	// The volume shadows the developer's directory rather than sharing it: their
	// file is not visible in the copy, and what the copy writes is not visible to
	// them. A baseline that counted whatever happened to be in uploads would
	// differ between machines.
	out, _, code, err := st.Exec(ctx, "web", "ls /www/uploads; echo written > /www/uploads/mine.txt")
	if err != nil || code != 0 {
		t.Fatalf("Exec: %v (exit %d)", err, code)
	}
	if strings.Contains(out, "theirs.txt") {
		t.Errorf("the copy can see the developer's uploads: %q", out)
	}
	if _, err := os.Stat(filepath.Join(dir, "www", "uploads", "mine.txt")); !os.IsNotExist(err) {
		t.Error("a write inside the copy landed in the developer's tree")
	}
	if body, err := os.ReadFile(filepath.Join(dir, "www", "uploads", "theirs.txt")); err != nil ||
		string(body) != "the developer's file\n" {
		t.Errorf("the developer's file changed: %q %v", body, err)
	}

	// A read-only source is the other half of that promise.
	if _, _, code, _ := st.Exec(ctx, "web", "echo no > /www/index.html"); code == 0 {
		t.Error("the copy wrote into the source it was given read-only")
	}

	if err := st.Down(ctx); err != nil {
		t.Fatalf("Down: %v", err)
	}
	if out := containers(t, st.project); out != "" {
		t.Errorf("teardown left containers: %s", out)
	}
	if out := volumes(t, st.project); out != "" {
		t.Errorf("teardown left volumes: %s", out)
	}
	if _, err := os.Stat(stackDir); !os.IsNotExist(err) {
		t.Errorf("the generated document outlived the run: %v", err)
	}
}

func containers(t *testing.T, project string) string {
	t.Helper()
	return dockerLines(t, "ps", "-a", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.Names}}")
}

func volumes(t *testing.T, project string) string {
	t.Helper()
	return dockerLines(t, "volume", "ls", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.Name}}")
}

func dockerLines(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.CommandContext(t.Context(), "docker", args...).Output()
	if err != nil {
		t.Fatalf("docker %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

// The reset needs no protocol knowledge: it clears the copy's volumes and lets the
// project's own schema steps rebuild it. So it holds for a datastore this build
// cannot read, which a dump-and-restore never could.
func TestResetRebuildsFromTheProjectsOwnSteps(t *testing.T) {
	ctx := live(t)
	dir := t.TempDir()
	write(t, filepath.Join(dir, "compose.yml"), `
services:
  web:
    image: alpine:latest
    command: ["sh", "-c", "mkdir -p /data/uploads; while true; do { printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n'; echo -n hi; } | nc -l -p 8080; done"]
    volumes:
      - shared:/data
  store:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: reset-fixture
      POSTGRES_DB: shop
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d shop"]
      interval: 2s
      retries: 30
  migrate:
    image: postgres:16
    profiles: [tools]
    environment:
      PGPASSWORD: reset-fixture
    command: ["psql", "-h", "store", "-U", "postgres", "-d", "shop", "-c",
              "CREATE TABLE rooms (id serial primary key); INSERT INTO rooms DEFAULT VALUES"]
    depends_on:
      store:
        condition: service_healthy
volumes:
  pgdata:
  shared:
`)

	c, err := ReadCompose(ctx, []string{filepath.Join(dir, "compose.yml")})
	if err != nil {
		t.Fatalf("ReadCompose: %v", err)
	}
	e := Environment{
		App: "web", Port: 8080,
		Database: "store", DBPort: 5432, Driver: "postgres",
		Login:    Login{User: "postgres", Password: "reset-fixture", Name: "$POSTGRES_DB"},
		Schema:   []SchemaStep{{Service: "migrate"}},
		Writable: []string{"/data/uploads"},
		Author:   AuthorAgent,
	}

	st, err := Launch(ctx, LaunchOptions{Compose: c, Environment: e, Name: "reset",
		OnProgress: func(string) {}})
	if err != nil {
		t.Fatalf("Launch: %v", err)
	}
	defer st.Down(context.Background())

	if err := st.Schema(ctx); err != nil {
		t.Fatalf("Schema: %v", err)
	}
	if err := st.Baseline(ctx); err != nil {
		t.Fatalf("Baseline: %v", err)
	}
	// Postgres discovery has to find the table and pick its serial key, or the
	// ledger would report a delta of zero for every insert.
	if got := st.Tables(); len(got) != 1 || got[0] != "rooms" {
		t.Fatalf("the ledger watches %v, want just rooms", got)
	}

	before, err := st.Watcher().Watermark(ctx)
	if err != nil {
		t.Fatalf("Watermark: %v", err)
	}

	// Research writes: two rows and a file, exactly what would make a later run
	// pass for the wrong reason.
	if _, err := st.DB().ExecContext(ctx,
		"INSERT INTO rooms DEFAULT VALUES; INSERT INTO rooms DEFAULT VALUES"); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if _, _, code, _ := st.Exec(ctx, "web", "echo x > /data/uploads/left-behind.txt"); code != 0 {
		t.Fatalf("could not write into the volume, exit %d", code)
	}

	dirty, err := st.Watcher().Watermark(ctx)
	if err != nil {
		t.Fatalf("Watermark: %v", err)
	}
	moved := dirty.Diff(before)
	if len(moved) != 2 {
		t.Fatalf("the ledger missed the writes: %+v", moved)
	}

	if err := st.Reset(ctx); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	after, err := st.Watcher().Watermark(ctx)
	if err != nil {
		t.Fatalf("Watermark after reset: %v", err)
	}
	if got := after.Diff(before); len(got) != 0 {
		t.Errorf("the reset did not return to the baseline: %+v", got)
	}
	out, _, _, err := st.Exec(ctx, "web", "ls /data/uploads")
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}
	if strings.Contains(out, "left-behind.txt") {
		t.Errorf("the reset left a research upload behind: %q", out)
	}
}

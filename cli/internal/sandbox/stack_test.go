package sandbox

import (
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

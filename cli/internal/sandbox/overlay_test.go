package sandbox

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// resolvedDoc is compose's own output shape: names stamped in, short forms
// expanded, paths absolute. Hand-written so the transform can be tested without
// docker, and checked against the real thing by the live test below.
const resolvedDoc = `{
  "name": "hotel",
  "networks": {
    "default": {"name": "hotel_default", "ipam": {}},
    "shared": {"name": "some-other-stack", "external": true}
  },
  "volumes": {"db-data": {"name": "hotel_db-data"}},
  "services": {
    "app": {
      "container_name": "hotel-app",
      "build": {"context": "/src/hotel", "dockerfile": "Dockerfile"},
      "cap_add": ["SYS_PTRACE"],
      "restart": "always",
      "ports": [{"mode": "ingress", "target": 8080, "published": "8080", "protocol": "tcp"}],
      "volumes": [
        {"type": "bind", "source": "/src/hotel", "target": "/app", "bind": {}},
        {"type": "bind", "source": "/src/hotel/api/uploads", "target": "/app/api/uploads", "bind": {}}
      ]
    },
    "db": {
      "image": "mariadb:10.4",
      "ports": [{"mode": "ingress", "target": 3306, "published": "3307", "protocol": "tcp"}],
      "volumes": [{"type": "volume", "source": "db-data", "target": "/var/lib/mysql", "volume": {}}]
    },
    "cache": {"image": "redis:7", "ports": ["6379:6379"]},
    "seed": {
      "build": {"context": "/src/hotel"},
      "profiles": ["tools"],
      "volumes": [{"type": "bind", "source": "/src/hotel", "target": "/app", "bind": {}}]
    }
  }
}`

func overlaid(t *testing.T, e Environment) (*Overlay, map[string]any) {
	t.Helper()
	c := &Compose{Name: "hotel", Files: []string{"compose.yml"}, raw: []byte(resolvedDoc)}
	got, err := c.Overlay(e, "gritqa-9f2c")
	if err != nil {
		t.Fatalf("Overlay: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(got.Document, &doc); err != nil {
		t.Fatalf("the document it produced is not readable: %v", err)
	}
	return got, doc
}

func svc(t *testing.T, doc map[string]any, name string) map[string]any {
	t.Helper()
	s, ok := doc["services"].(map[string]any)[name].(map[string]any)
	if !ok {
		t.Fatalf("no %s service in the overlay", name)
	}
	return s
}

// The copy must not be able to reach anything of the developer's: not their
// volume, not their ports, not their working tree. Each assertion here is one way
// it could, closed.
func TestOverlayCannotReachTheOriginal(t *testing.T) {
	got, doc := overlaid(t, Environment{
		App: "app", Port: 8080, Database: "db", DBPort: 3306, Driver: "mysql",
		Schema:   []SchemaStep{{Service: "seed"}},
		Writable: []string{"/app/api/uploads"},
	})

	if doc["name"] != "gritqa-9f2c" {
		t.Errorf("project name = %v", doc["name"])
	}

	// The name compose resolved is the developer's volume. Stripped, the project
	// name scopes it, which is the whole of the data isolation.
	vols := doc["volumes"].(map[string]any)
	if entry := vols["db-data"].(map[string]any); entry["name"] != nil {
		t.Errorf("db-data kept the name compose stamped in: %v", entry["name"])
	}
	nets := doc["networks"].(map[string]any)
	if entry := nets["shared"].(map[string]any); entry["external"] != nil || entry["name"] != nil {
		t.Errorf("the external network survived: %v", entry)
	}
	if want := "networks shared"; !contains(got.Detached, want) {
		t.Errorf("Detached = %v, want %s in it", got.Detached, want)
	}

	// Every fixed host port is reported and gone, and only two come back -- on
	// loopback, with the host port left for the kernel to pick.
	for _, want := range []string{"app 8080", "db 3307", "cache 6379"} {
		if !contains(got.Dropped, want) {
			t.Errorf("Dropped = %v, want %s in it", got.Dropped, want)
		}
	}
	if p := svc(t, doc, "app")["ports"]; !sameJSON(p, []any{"127.0.0.1::8080"}) {
		t.Errorf("app ports = %v", p)
	}
	if p := svc(t, doc, "db")["ports"]; !sameJSON(p, []any{"127.0.0.1::3306"}) {
		t.Errorf("db ports = %v", p)
	}
	if p, ok := svc(t, doc, "cache")["ports"]; ok {
		t.Errorf("cache still publishes %v, and nothing asked it to", p)
	}

	// The source is the developer's working tree. A run that wrote to it would be
	// editing their files.
	for _, m := range svc(t, doc, "app")["volumes"].([]any) {
		entry := m.(map[string]any)
		if entry["type"] == "bind" && entry["read_only"] != true {
			t.Errorf("bind mount at %v is writable", entry["target"])
		}
	}
	if s := svc(t, doc, "app")["restart"]; s != "no" {
		t.Errorf("restart = %v, so teardown would not be the end of it", s)
	}
	if _, ok := svc(t, doc, "app")["container_name"]; ok {
		t.Error("container_name survived, and it is the original's name")
	}
}

// An upload has to land somewhere, and the one place it must not land is the
// bind mount the developer is working in. The volume replaces that bind rather
// than sitting beside it, because compose refuses two mounts on one target.
func TestOverlayPutsAVolumeWhereTheAppWrites(t *testing.T) {
	got, doc := overlaid(t, Environment{
		App: "app", Port: 8080,
		Schema:   []SchemaStep{{Service: "seed"}},
		Writable: []string{"/app/api/uploads"},
	})

	if len(got.Shared) != 1 {
		t.Fatalf("Shared = %v, want one volume for the one writable path", got.Shared)
	}
	name := got.Shared[0]
	if _, ok := doc["volumes"].(map[string]any)[name]; !ok {
		t.Errorf("%s is mounted but never declared", name)
	}

	// On the app and on the seeder both: a seeder that writes a file and an app
	// that serves it back have to be looking at the same volume.
	for _, service := range []string{"app", "seed"} {
		var found int
		for _, m := range svc(t, doc, service)["volumes"].([]any) {
			entry := m.(map[string]any)
			if entry["target"] != "/app/api/uploads" {
				continue
			}
			found++
			if entry["type"] != "volume" || entry["source"] != name {
				t.Errorf("%s mounts %v at the writable path", service, entry)
			}
		}
		if found != 1 {
			t.Errorf("%s has %d mounts at /app/api/uploads, want exactly one", service, found)
		}
	}
}

// The overlay edits a document rather than rewriting one, so a key GritQA has
// never heard of has to come out the far side untouched. Anything else would make
// booting a copy quietly lossy.
func TestOverlayCarriesWhatItDoesNotUnderstand(t *testing.T) {
	_, doc := overlaid(t, Environment{App: "app", Port: 8080})

	if caps := svc(t, doc, "app")["cap_add"]; !sameJSON(caps, []any{"SYS_PTRACE"}) {
		t.Errorf("cap_add = %v, and nothing in GritQA parses it", caps)
	}
	if b := svc(t, doc, "app")["build"].(map[string]any); b["context"] != "/src/hotel" {
		t.Errorf("build context = %v", b["context"])
	}
	if p := svc(t, doc, "seed")["profiles"]; !sameJSON(p, []any{"tools"}) {
		t.Errorf("the seeder lost the profile gating it: %v", p)
	}
}

func TestOverlayNeedsADocumentItCanRead(t *testing.T) {
	if _, err := (&Compose{Name: "hotel"}).Overlay(Environment{App: "app", Port: 80}, "p"); err == nil {
		t.Error("a Compose that was never read produced a bootable document")
	}
}

// Through real compose: the generated document has to be something compose
// accepts, and the names it reports back have to be the copy's and not the
// original's.
func TestOverlayIsSomethingComposeAccepts(t *testing.T) {
	live(t)
	dir := t.TempDir()
	write(t, filepath.Join(dir, "compose.yml"), `
name: shop
services:
  web:
    image: nginx:alpine
    container_name: shop-web
    restart: always
    ports: ["8099:80"]
    volumes:
      - .:/src
  store:
    image: postgres:16
    ports: ["5439:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`)
	c, err := ReadCompose(t.Context(), []string{filepath.Join(dir, "compose.yml")})
	if err != nil {
		t.Fatalf("ReadCompose: %v", err)
	}
	e := Environment{App: "web", Port: 80, Database: "store", DBPort: 5432, Driver: "postgres",
		Writable: []string{"/src/uploads"}}
	got, err := c.Overlay(e, "gritqa-overlay-test")
	if err != nil {
		t.Fatalf("Overlay: %v", err)
	}
	gen := filepath.Join(dir, "gritqa.yaml")
	if err := os.WriteFile(gen, got.Document, 0o600); err != nil {
		t.Fatal(err)
	}

	cmd := exec.CommandContext(t.Context(), "docker", "compose",
		"-p", got.Project, "-f", gen, "config", "--format", "json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("compose refused the document GritQA generated:\n%s", out)
	}
	var doc map[string]any
	if err := json.Unmarshal(out, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["name"] != got.Project {
		t.Errorf("project = %v, want %s", doc["name"], got.Project)
	}
	// compose stamps the names in again, and this time they are the copy's.
	for block, name := range map[string]string{"volumes": "pgdata", "networks": "default"} {
		entry := doc[block].(map[string]any)[name].(map[string]any)
		if want := got.Project + "_" + name; entry["name"] != want {
			t.Errorf("%s %s resolved to %v, want %s", block, name, entry["name"], want)
		}
	}
	if s := string(out); strings.Contains(s, "shop_") || strings.Contains(s, "shop-web") {
		t.Error("the copy still carries the original project's identity")
	}
}

func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

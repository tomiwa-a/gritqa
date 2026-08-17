package lang

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectReadsEachManifest(t *testing.T) {
	cases := []struct {
		name     string
		manifest string
		body     string
		want     []ID
	}{
		{"go.mod", "go.mod", `module example.com/api

require (
	github.com/go-chi/chi/v5 v5.0.12
	github.com/gin-gonic/gin v1.9.1
)
`, []ID{Chi, Gin}},

		{"package.json", "package.json", `{
  "name": "api",
  "version": "1.0.0",
  "dependencies": {"express": "^4.18.0"},
  "devDependencies": {"fastify": "^4.0.0"}
}`, []ID{Express, Fastify}},

		{"requirements.txt", "requirements.txt", "fastapi==0.110.0\nuvicorn==0.29.0\n", []ID{FastAPI}},

		// django-extensions in a requirements file still means Django.
		{"loose python match", "requirements.txt", "django-extensions==3.2.3\n", []ID{Django}},

		{"pyproject.toml", "pyproject.toml", "[project]\ndependencies = [\"flask>=3\"]\n", []ID{Flask}},

		{"Gemfile", "Gemfile", "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n", []ID{Rails}},

		{"composer.json", "composer.json", `{"require": {"laravel/framework": "^11.0"}}`, []ID{Laravel}},

		{"pom.xml", "pom.xml", `<project><artifactId>spring-boot-starter-web</artifactId></project>`, []ID{Spring}},

		{"no framework", "go.mod", "module example.com/tool\n", nil},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			write(t, filepath.Join(root, c.manifest), c.body)

			got := Detect(root)
			if !equal(got, c.want) {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

// A framework named in prose, not in the dependency list, is not a declaration.
func TestDetectIgnoresNonDependencyJSONFields(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "package.json"),
		`{"name": "api", "description": "an express-style server", "dependencies": {"pg": "^8"}}`)

	if got := Detect(root); len(got) != 0 {
		t.Errorf("got %v, want none", got)
	}
}

func TestDetectWithNoManifest(t *testing.T) {
	if got := Detect(t.TempDir()); got != nil {
		t.Errorf("got %v, want nil", got)
	}
}

func TestOrderFollowsTheTable(t *testing.T) {
	got := Order([]ID{Fiber, Chi, Chi, NetHTTP})
	want := []ID{NetHTTP, Chi, Fiber}
	if !equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestReadableSeparatesWhatCanBeParsed(t *testing.T) {
	if !Readable([]ID{Django, Chi}) {
		t.Error("chi is readable")
	}
	if Readable([]ID{Django, Rails}) {
		t.Error("neither Django nor Rails is readable yet")
	}
	if got := Unreadable([]ID{Chi, Django, Rails}); !equal(got, []ID{Django, Rails}) {
		t.Errorf("got %v, want [django rails]", got)
	}
}

func equal(a, b []ID) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

package lang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const maxManifestSize = 1 << 20

// Detect reports which frameworks the project's dependency manifests declare.
// It reads manifests rather than guessing from directory names, and it does not
// care which manifest declares what — fastapi will not turn up in a Gemfile.
func Detect(root string) []ID {
	declared := declarations(root)
	if declared == "" {
		return nil
	}

	var ids []ID
	for _, f := range Frameworks {
		if f.Dep != "" && strings.Contains(declared, f.Dep) {
			ids = append(ids, f.ID)
		}
	}
	return Order(ids)
}

// manifests are the dependency files worth reading, and whether their
// dependency names can be pulled out exactly.
var manifests = map[string]bool{
	"go.mod":           false,
	"package.json":     true,
	"composer.json":    true,
	"requirements.txt": false,
	"pyproject.toml":   false,
	"Pipfile":          false,
	"Gemfile":          false,
	"pom.xml":          false,
	"build.gradle":     false,
	"build.gradle.kts": false,
}

// declarations builds one searchable blob from whatever manifests exist. JSON
// manifests contribute only their dependency keys, so a framework named in a
// description does not count; the rest contribute raw text, where a loose match
// is the right call — django-extensions in requirements.txt does mean Django.
func declarations(root string) string {
	var b strings.Builder

	for name, structured := range manifests {
		body, err := readCapped(filepath.Join(root, name))
		if err != nil {
			continue
		}
		if structured {
			for _, dep := range jsonDeps(body) {
				b.WriteString(dep)
				b.WriteByte('\n')
			}
			continue
		}
		b.Write(body)
		b.WriteByte('\n')
	}
	return b.String()
}

func readCapped(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() || info.Size() > maxManifestSize {
		return nil, os.ErrInvalid
	}
	return os.ReadFile(path)
}

// jsonDeps pulls dependency names out of package.json or composer.json. The
// two-step decode is because the sibling keys of "dependencies" are strings, so
// the document will not unmarshal into a map of maps.
func jsonDeps(body []byte) []string {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil
	}

	var out []string
	for _, section := range []string{"dependencies", "devDependencies", "require", "require-dev"} {
		var deps map[string]json.RawMessage
		if err := json.Unmarshal(doc[section], &deps); err != nil {
			continue
		}
		for name := range deps {
			out = append(out, name)
		}
	}
	return out
}

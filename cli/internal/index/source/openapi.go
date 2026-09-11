package source

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"

	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
)

// fromSpec reads an OpenAPI or Swagger document. One parser covers every
// language, which is why this sits above static extraction on the ladder.
func fromSpec(root, hint string) (Result, error) {
	rel := hint
	if rel == "" {
		rel = findSpec(root)
	}
	if rel == "" {
		return Result{}, nil
	}

	body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		if hint == "" {
			return Result{}, nil
		}
		return Result{}, fmt.Errorf("endpoints.spec: %w", err)
	}

	rs, err := parseSpec(rel, body)
	if err != nil {
		return Result{}, fmt.Errorf("%s: %w", rel, err)
	}
	if len(rs) == 0 {
		if hint == "" {
			return Result{}, nil
		}
		return Result{}, fmt.Errorf("%s declares no paths", rel)
	}

	routes.Sort(rs)
	return Result{Kind: Spec, Detail: rel, Routes: routes.Dedupe(rs)}, nil
}

// specNames are the conventional filenames, checked against specDirs. Anything
// else the user points at with endpoints.spec.
var specNames = []string{
	"openapi.yaml", "openapi.yml", "openapi.json",
	"swagger.yaml", "swagger.yml", "swagger.json",
}

var specDirs = []string{".", "api", "docs", "spec", "openapi", "static"}

func findSpec(root string) string {
	for _, dir := range specDirs {
		for _, name := range specNames {
			rel := filepath.ToSlash(filepath.Join(dir, name))
			if info, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err == nil && !info.IsDir() {
				return rel
			}
		}
	}
	return ""
}

// parseSpec walks the document as a YAML node tree rather than decoding it into
// a struct, so every endpoint keeps the line it was declared on and the coverage
// grid can link straight to it. JSON parses through the same path.
func parseSpec(rel string, body []byte) ([]routes.Route, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 {
		return nil, nil
	}
	top := doc.Content[0]

	base := basePath(top)
	global := schemes(field(top, "security"))
	paths := field(top, "paths")
	if paths == nil {
		return nil, nil
	}

	var out []routes.Route
	for i := 0; i+1 < len(paths.Content); i += 2 {
		pattern, item := paths.Content[i], paths.Content[i+1]

		for j := 0; j+1 < len(item.Content); j += 2 {
			verb, op := item.Content[j], item.Content[j+1]
			method, ok := routes.Method(verb.Value)
			if !ok {
				continue
			}

			guards := global
			if own := field(op, "security"); own != nil {
				guards = schemes(own)
			}

			out = append(out, routes.Route{
				Method:     method,
				Path:       routes.Join(base, pattern.Value),
				File:       rel,
				Line:       verb.Line,
				Handler:    text(field(op, "operationId")),
				Middleware: guards,
			})
		}
	}
	return out, nil
}

// basePath is the prefix the spec mounts itself under: servers[0].url in
// OpenAPI 3, basePath in Swagger 2. Missing it would put every endpoint one
// segment away from the path the tests have to call.
func basePath(top *yaml.Node) string {
	if legacy := text(field(top, "basePath")); legacy != "" {
		return legacy
	}

	servers := field(top, "servers")
	if servers == nil || len(servers.Content) == 0 {
		return ""
	}
	raw := text(field(servers.Content[0], "url"))
	if raw == "" {
		return ""
	}
	if u, err := url.Parse(raw); err == nil {
		return u.Path
	}
	return ""
}

// schemes names the security requirements on an operation. They become
// middleware, which is what makes "needs a logged-in user" work for a project
// GritQA only ever read a spec for.
func schemes(security *yaml.Node) []string {
	if security == nil {
		return nil
	}

	var out []string
	for _, requirement := range security.Content {
		for i := 0; i+1 < len(requirement.Content); i += 2 {
			out = append(out, requirement.Content[i].Value)
		}
	}
	return out
}

func field(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}

func text(n *yaml.Node) string {
	if n == nil {
		return ""
	}
	return n.Value
}

// Package source decides where a project's endpoints come from.
//
// The sources form a ladder, cheapest and most private first: what the user
// declared, then a spec already in the repo, then parsing the source itself.
// Whatever a cheaper source answers, the expensive ones never see.
package source

import (
	"fmt"
	"strings"

	"github.com/gritqa/cli/internal/index/routes"
)

// Kind names the source that supplied a project's endpoints. The values are
// what the transcript prints, so they read as an answer to "where did these
// come from".
type Kind string

const (
	None   Kind = ""
	List   Kind = "your config"
	Spec   Kind = "your API spec"
	Static Kind = "your source"
)

// Result is what one source found. Unresolved holds endpoints that were
// recognised but whose absolute path could not be worked out — reported rather
// than guessed, because an invented endpoint gets tests drafted against it.
type Result struct {
	Kind       Kind
	Detail     string
	Routes     []routes.Route
	Unresolved []routes.Route
}

func (r Result) Empty() bool { return r.Kind == None }

// Resolve tries the project-level sources, which need no file pass at all. An
// empty Result means the per-file sources have to do the work.
func Resolve(root string, list []string, spec string) (Result, error) {
	if len(list) > 0 {
		return fromList(list)
	}
	return fromSpec(root, spec)
}

// fromList reads endpoints.list out of the config: the escape hatch for a
// project GritQA cannot read on its own.
func fromList(list []string) (Result, error) {
	out := make([]routes.Route, 0, len(list))

	for i, entry := range list {
		method, path, ok := strings.Cut(strings.TrimSpace(entry), " ")
		if !ok {
			return Result{}, fmt.Errorf(
				"endpoints.list[%d]: %q should read like \"GET /orders\"", i, entry)
		}
		m, ok := routes.Method(method)
		if !ok {
			return Result{}, fmt.Errorf(
				"endpoints.list[%d]: %q is not a method the dashboard can show", i, method)
		}
		out = append(out, routes.Route{
			Method: m,
			Path:   routes.Normalize(path),
			File:   configFile,
			Line:   i + 1,
		})
	}

	routes.Sort(out)
	return Result{Kind: List, Detail: configFile, Routes: routes.Dedupe(out)}, nil
}

const configFile = ".gritqa/config.yaml"

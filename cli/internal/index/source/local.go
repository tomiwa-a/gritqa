package source

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/index/routes"
	"github.com/tomiwa-a/gritqa/cli/internal/model"
)

const extractSystem = `You read one source file and list the HTTP endpoints it serves.

Reply with one JSON object and nothing else:

{"endpoints": [
  {"method": "POST", "path": "/api/rooms", "line": 42,
   "handler": "RoomController.create", "middleware": ["requireAdmin"]},
  {"method": "GET", "path": "/index.php?controller=rooms&action=list", "line": 61,
   "handler": "RoomController::list", "middleware": []}
]}

Two, because the shape is whatever the file serves. The first is a project with
a router; the second is one that routes on the query string, and copying that
URL as it stands is the rule rather than an exception.

Rules:
- path is what a client actually types. Copy the URL this file serves, query
  string included when the routing itself is done with query parameters. Never
  tidy it into a REST shape the server does not serve.
- You may be shown a gateway file: the front controller requests arrive at before
  they reach this one. When you are, the path is the whole URL through it — find
  the branch that reaches this file, take the parameters that branch needs, and
  add this file's own. A path that skips the gateway is a 404.
- method is GET, POST, PUT, PATCH or DELETE. Leave it "" when the file does not
  say which one it accepts.
- line is where the endpoint is declared in this file. handler is the function or
  method that serves it. middleware lists the guards it passes through, if any.
- List only what this file serves, and only what you can see. If it serves none,
  reply {"endpoints": []}. Never infer a URL from a name, a comment or a framework
  convention: a path that does not exist gets tests written against it and every
  one of them 404s.`

// Local reads endpoints with the user's own key, no server in between. It is the
// same choice draft.Local makes, for the same reason.
type Local struct {
	Model *model.Client
}

func (l *Local) Extract(ctx context.Context, f File) ([]routes.Route, error) {
	raw, err := l.Model.Complete(ctx, []model.Message{
		{Role: "system", Content: extractSystem},
		{Role: "user", Content: brief(f)},
	})
	if err != nil {
		return nil, err
	}
	return parseExtraction(raw)
}

// parseExtraction unwraps a prose-wrapped reply and accepts a bare array, which
// is the one shape a model reaches for instead of the object it was asked for.
func parseExtraction(raw string) ([]routes.Route, error) {
	// A non-nil slice means the object really carried the key, so {"endpoints":[]}
	// still means "this file serves none" rather than falling through.
	if body, ok := span(raw, '{', '}'); ok {
		var out extractResponse
		if err := json.Unmarshal([]byte(body), &out); err == nil && out.Endpoints != nil {
			return out.Endpoints, nil
		}
	}
	if body, ok := span(raw, '[', ']'); ok {
		var out []routes.Route
		if err := json.Unmarshal([]byte(body), &out); err == nil {
			return out, nil
		}
	}
	return nil, errors.New("the reply was not the endpoint list it was asked for")
}

func span(raw string, open, shut byte) (string, bool) {
	start := strings.IndexByte(raw, open)
	end := strings.LastIndexByte(raw, shut)
	if start < 0 || end <= start {
		return "", false
	}
	return raw[start : end+1], true
}

func brief(f File) string {
	var b strings.Builder
	for _, c := range f.Context {
		fmt.Fprintf(&b, "Gateway: %s — requests reach the file below through this one.\n\n%s\n\n",
			c.Path, c.Content)
	}
	fmt.Fprintf(&b, "File: %s\nLanguage: %s\n\n%s", f.Path, f.Language, f.Content)
	return b.String()
}

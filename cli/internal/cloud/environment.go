package cloud

import (
	"context"
	"net/http"
	"sort"

	"github.com/gritqa/cli/internal/sandbox"
)

// The environment: the compose file goes up, the judgement comes back.
//
//	POST /api/cli/environment   Authorization: Bearer <cli token>
//	{ "instanceId": "...", "projectName": "...", "fingerprint": "...",
//	  "files": ["compose.yaml"],
//	  "services": [ { name, image, build, command, ports, profiles, env } ] }
//	-> 200 { "ok": true, "status": "approved" | "proposed" | "none",
//	         "environment": <sandbox.Environment> | null, "fingerprint": "...",
//	         "stale": false }
//
// One route rather than two. The CLI shells `docker compose config` on every boot
// anyway, so pushing the file it just read and taking the answer in the same reply
// is one round trip, and the answer can never be for a different file than the one
// about to boot.
//
// `env` is variable names and never values. Compose expands ${MYSQL_ROOT_PASSWORD}
// to the real password and a file can also write one in literally -- either way a
// value here would put somebody's secret in a database over the network. A login
// refers to a variable by name; the value is read at boot, here.
const environmentPath = "/api/cli/environment"

type ComposePush struct {
	InstanceID  string          `json:"instanceId"`
	ProjectName string          `json:"projectName"`
	Fingerprint string          `json:"fingerprint"`
	Files       []string        `json:"files"`
	Services    []ComposeDeclar `json:"services"`
}

// ComposeDeclar is one service, trimmed to what a person needs to recognise it and
// what the agent needs to guess at what it is for.
type ComposeDeclar struct {
	Name     string        `json:"name"`
	Image    string        `json:"image,omitempty"`
	Build    string        `json:"build,omitempty"`
	Command  []string      `json:"command,omitempty"`
	Ports    []ComposePort `json:"ports,omitempty"`
	Profiles []string      `json:"profiles,omitempty"`
	Env      []string      `json:"env,omitempty"`
}

type ComposePort struct {
	Container int    `json:"container"`
	Published string `json:"published,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
}

// Judged is what the dashboard says to do with this project.
//
// Status "none" is an ordinary answer and not an error: nobody has approved an
// environment yet, so the CLI carries on with whatever it already had.
type Judged struct {
	Status      string               `json:"status"`
	Environment *sandbox.Environment `json:"environment"`
	Fingerprint string               `json:"fingerprint"`
	Stale       bool                 `json:"stale"`
}

// Approved reports whether this answer is something a boot may read.
func (j *Judged) Approved() bool { return j != nil && j.Status == "approved" && j.Environment != nil }

func (c *Client) PushCompose(ctx context.Context, push ComposePush) (*Judged, error) {
	r, err := c.call(ctx, http.MethodPost, environmentPath, push)
	if err != nil {
		return nil, err
	}
	if !r.ok() {
		return nil, c.fail(environmentPath, r)
	}
	out := &Judged{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

// Declared flattens a compose read into what the dashboard holds. Sorted by name so
// two pushes of the same file are the same bytes.
func Declared(instanceID string, c *sandbox.Compose) ComposePush {
	services := make([]ComposeDeclar, 0, len(c.Services))
	for _, s := range c.Services {
		out := ComposeDeclar{
			Name:     s.Name,
			Image:    cut(s.Image, 1024),
			Build:    cut(s.Build, 1024),
			Command:  s.Command,
			Profiles: s.Profiles,
			Env:      names(s.Environment),
		}
		for _, p := range s.Ports {
			out.Ports = append(out.Ports, ComposePort{
				Container: p.Container,
				Published: p.Published,
				Protocol:  p.Protocol,
			})
		}
		services = append(services, out)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })

	return ComposePush{
		InstanceID:  instanceID,
		ProjectName: cut(c.Name, 255),
		Fingerprint: cut(c.Fingerprint, 64),
		Files:       c.Files,
		Services:    services,
	}
}

// names is the keys and none of the values, sorted.
func names(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k := range env {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

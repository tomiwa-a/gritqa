package sandbox

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Compose is the developer's compose file as compose itself resolves it:
// interpolation done, .env applied, overrides merged, every short form expanded
// to its long one. Reading it is deterministic because the schema is fixed and
// the resolving is compose's own work, not ours.
//
// What any of it means is not decided here. Which service is the app, which is
// the database, which port is HTTP, what has to be neutralised before GritQA
// boots a copy -- every one of those is a judgement about someone else's
// declaration, and it belongs to the agent reading this.
type Compose struct {
	Name     string    `json:"name"`
	Files    []string  `json:"files"`
	Profiles []string  `json:"profiles,omitempty"`
	Services []Service `json:"services"`
	// Volumes are the named volumes the file declares. They survive a down
	// without -v, which is why a sandbox cannot use them as they stand.
	Volumes []string `json:"volumes,omitempty"`
	// Fingerprint covers the resolved document and every Dockerfile it builds
	// from. It moves when the environment changes and not when source does.
	Fingerprint string `json:"fingerprint"`

	// raw is the resolved document as compose printed it, kept for the two things
	// the reported shape deliberately cannot carry: booting a copy of the whole
	// declaration, including every key nothing above parses, and reading back a
	// credential the report masked.
	raw []byte
}

// resolved re-reads the document with nothing masked. For connecting, not for
// reporting: the values in it are the developer's own.
func (c *Compose) resolved() (*Compose, error) {
	if len(c.raw) == 0 {
		return nil, errors.New("this compose file was described rather than read, " +
			"so the document it came from is not here")
	}
	return parseCompose(c.raw)
}

// Service is one service, with the fields that bear on bringing it up.
type Service struct {
	Name string `json:"name"`
	// Image and Build are exclusive in practice: a service either pulls or builds.
	Image      string `json:"image,omitempty"`
	Build      string `json:"build,omitempty"`
	Dockerfile string `json:"dockerfile,omitempty"`

	Entrypoint []string `json:"entrypoint,omitempty"`
	Command    []string `json:"command,omitempty"`
	WorkingDir string   `json:"working_dir,omitempty"`
	User       string   `json:"user,omitempty"`
	// Environment holds the value the file declares literally, or the ${...}
	// expression it came from when the value arrived from outside the file. A
	// name written into compose.yml is already in the developer's repository; a
	// name resolved out of .env or the shell can be a live credential, and the
	// expression says where it comes from without disclosing what it is.
	Environment map[string]string `json:"environment,omitempty"`
	Ports       []Port            `json:"ports,omitempty"`
	Mounts      []Mount           `json:"mounts,omitempty"`
	DependsOn   []Need            `json:"depends_on,omitempty"`
	Healthcheck []string          `json:"healthcheck,omitempty"`
	// Profiles gate a service: compose does not start it unless the profile is
	// asked for. A migration runner is often parked behind one.
	Profiles []string `json:"profiles,omitempty"`
	Restart  string   `json:"restart,omitempty"`
}

// Port is one published port. Published is a string because compose allows a
// range, and empty means the container port is not published to the host at all.
type Port struct {
	Container int    `json:"container"`
	Published string `json:"published,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
}

// Mount is one volume entry. Kind is bind, volume or tmpfs -- the difference
// decides whether run two can inherit what run one wrote.
type Mount struct {
	Kind     string `json:"kind"`
	Source   string `json:"source,omitempty"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"read_only,omitempty"`
}

// Need is one depends_on edge, with the condition compose waits for.
type Need struct {
	Service   string `json:"service"`
	Condition string `json:"condition,omitempty"`
	Required  bool   `json:"required"`
}

// composeFiles is compose's own default lookup order.
var composeFiles = []string{"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"}

// FindCompose returns the compose files in a directory, in compose's order, or
// nil when there are none. Only the first match is returned because that is what
// compose itself would use.
func FindCompose(dir string) []string {
	for _, name := range composeFiles {
		if path := filepath.Join(dir, name); exists(path) {
			return []string{path}
		}
	}
	return nil
}

// LocateCompose decides which compose files to read: the ones the user named,
// or whatever compose's own lookup finds. The project root is tried first and
// the mount second, because .gritqa can sit in a subdirectory of the repository
// while the compose file sits at its root.
func LocateCompose(root, mount string, configured []string) []string {
	if len(configured) > 0 {
		out := make([]string, 0, len(configured))
		for _, f := range configured {
			if !filepath.IsAbs(f) {
				f = filepath.Join(root, f)
			}
			out = append(out, filepath.Clean(f))
		}
		return out
	}
	for _, dir := range []string{root, mount} {
		if dir == "" {
			continue
		}
		if found := FindCompose(dir); found != nil {
			return found
		}
	}
	return nil
}

// ReadCompose resolves the files through docker compose config and reports what
// they declare.
func ReadCompose(ctx context.Context, files []string) (*Compose, error) {
	if len(files) == 0 {
		return nil, fmt.Errorf("no compose file to read")
	}

	resolved, err := composeConfig(ctx, files)
	if err != nil {
		return nil, err
	}
	// The same document with nothing filled in, so a value that came from .env
	// or the shell can be told from one written into the file. Both passes are
	// compose's own resolving; the difference between them is the disclosure.
	literal, err := composeConfig(ctx, files, "--no-interpolate", "--no-env-resolution")
	if err != nil {
		return nil, err
	}

	c, err := parseCompose(resolved)
	if err != nil {
		return nil, err
	}
	if lit, err := parseCompose(literal); err == nil {
		keepLiterals(c, lit)
	}
	c.Files = files

	fp, err := composeFingerprint(resolved, c.Services)
	if err != nil {
		return nil, err
	}
	c.Fingerprint = fp
	c.raw = resolved
	return c, nil
}

// composeConfig runs config and hands back the canonical document.
func composeConfig(ctx context.Context, files []string, extra ...string) ([]byte, error) {
	args := []string{"compose"}
	for _, f := range files {
		args = append(args, "-f", f)
	}
	// Every profile is asked for, so a service parked behind one is reported
	// rather than hidden -- a runner the developer gated is exactly the kind of
	// thing worth seeing. Each service says which profiles gate it.
	args = append(args, "--profile", "*", "config", "--format", "json")
	args = append(args, extra...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = filepath.Dir(files[0])
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		// Compose's own message names the line and the reason. Ours would only
		// bury it, and the file is the developer's to fix.
		if msg := strings.TrimSpace(errb.String()); msg != "" {
			return nil, fmt.Errorf("%s cannot be read:\n%s", strings.Join(files, ", "), msg)
		}
		return nil, fmt.Errorf("reading %s: %w", strings.Join(files, ", "), err)
	}
	return out.Bytes(), nil
}

// keepLiterals replaces anything interpolation filled in with what the file
// actually says. A value only survives when both passes agree on it.
//
// Environment is the channel that matters, because compose is where credentials
// are conventionally declared, but a command can carry one too, so the same rule
// covers the two fields that take free text.
func keepLiterals(resolved, literal *Compose) {
	for i, svc := range resolved.Services {
		lit, ok := literal.Service(svc.Name)
		if !ok {
			continue
		}
		for name, value := range svc.Environment {
			was, declared := lit.Environment[name]
			switch {
			case !declared:
				// Present once resolved and absent from the file itself: it came
				// out of an env_file, so only the name is ours to report.
				resolved.Services[i].Environment[name] = "<from env_file>"
			case was != value:
				resolved.Services[i].Environment[name] = was
			}
		}
		if !sameArgs(svc.Command, lit.Command) {
			resolved.Services[i].Command = lit.Command
		}
		if !sameArgs(svc.Entrypoint, lit.Entrypoint) {
			resolved.Services[i].Entrypoint = lit.Entrypoint
		}
	}
}

func sameArgs(a, b []string) bool {
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

// document mirrors compose's JSON. Only the long forms appear, because config
// has already expanded every short one.
type document struct {
	Name     string `json:"name"`
	Services map[string]struct {
		Image string `json:"image"`
		Build *struct {
			Context    string `json:"context"`
			Dockerfile string `json:"dockerfile"`
		} `json:"build"`
		Entrypoint  []string           `json:"entrypoint"`
		Command     []string           `json:"command"`
		WorkingDir  string             `json:"working_dir"`
		User        string             `json:"user"`
		Restart     string             `json:"restart"`
		Profiles    []string           `json:"profiles"`
		Environment map[string]*string `json:"environment"`
		Ports       []struct {
			Target    int    `json:"target"`
			Published string `json:"published"`
			Protocol  string `json:"protocol"`
		} `json:"ports"`
		Volumes []struct {
			Type     string `json:"type"`
			Source   string `json:"source"`
			Target   string `json:"target"`
			ReadOnly bool   `json:"read_only"`
		} `json:"volumes"`
		DependsOn map[string]struct {
			Condition string `json:"condition"`
			Required  bool   `json:"required"`
		} `json:"depends_on"`
		Healthcheck *struct {
			Test     []string `json:"test"`
			Disable  bool     `json:"disable"`
			Interval string   `json:"interval"`
			Retries  int      `json:"retries"`
		} `json:"healthcheck"`
	} `json:"services"`
	Volumes map[string]json.RawMessage `json:"volumes"`
}

func parseCompose(b []byte) (*Compose, error) {
	var doc document
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("compose config returned something unreadable: %w", err)
	}

	out := &Compose{Name: doc.Name}
	seen := map[string]bool{}
	for name, s := range doc.Services {
		svc := Service{
			Name:        name,
			Image:       s.Image,
			Entrypoint:  s.Entrypoint,
			Command:     s.Command,
			WorkingDir:  s.WorkingDir,
			User:        s.User,
			Restart:     s.Restart,
			Profiles:    s.Profiles,
			Environment: map[string]string{},
		}
		if s.Build != nil {
			svc.Build = s.Build.Context
			svc.Dockerfile = s.Build.Dockerfile
		}
		for k, v := range s.Environment {
			if v == nil {
				svc.Environment[k] = ""
				continue
			}
			svc.Environment[k] = *v
		}
		if len(svc.Environment) == 0 {
			svc.Environment = nil
		}
		for _, p := range s.Ports {
			svc.Ports = append(svc.Ports, Port{Container: p.Target, Published: p.Published, Protocol: p.Protocol})
		}
		for _, v := range s.Volumes {
			svc.Mounts = append(svc.Mounts, Mount{Kind: v.Type, Source: v.Source, Target: v.Target, ReadOnly: v.ReadOnly})
		}
		for dep, on := range s.DependsOn {
			svc.DependsOn = append(svc.DependsOn, Need{Service: dep, Condition: on.Condition, Required: on.Required})
		}
		sort.Slice(svc.DependsOn, func(i, j int) bool { return svc.DependsOn[i].Service < svc.DependsOn[j].Service })
		if s.Healthcheck != nil && !s.Healthcheck.Disable {
			svc.Healthcheck = s.Healthcheck.Test
		}
		for _, p := range s.Profiles {
			if !seen[p] {
				seen[p], out.Profiles = true, append(out.Profiles, p)
			}
		}
		out.Services = append(out.Services, svc)
	}

	// Sorted, because a map is walked in a different order every time and two
	// reads of an unchanged file have to report the same thing.
	sort.Slice(out.Services, func(i, j int) bool { return out.Services[i].Name < out.Services[j].Name })
	sort.Strings(out.Profiles)
	for name := range doc.Volumes {
		out.Volumes = append(out.Volumes, name)
	}
	sort.Strings(out.Volumes)
	return out, nil
}

// composeFingerprint hashes the resolved document plus every Dockerfile it
// builds from.
//
// The document alone is not enough: editing a Dockerfile changes the image and
// leaves the compose file byte-identical. Source is deliberately not covered --
// editing a controller cannot change how the project boots.
func composeFingerprint(doc []byte, services []Service) (string, error) {
	h := sha256.New()
	h.Write([]byte("compose\x00"))
	h.Write(doc)
	for _, s := range services {
		if s.Build == "" {
			continue
		}
		name := s.Dockerfile
		if name == "" {
			name = "Dockerfile"
		}
		path := name
		if !filepath.IsAbs(path) {
			path = filepath.Join(s.Build, name)
		}
		sum, err := fileSum(path)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(h, "\x00%s\x00%s", s.Name, sum)
	}
	return hex.EncodeToString(h.Sum(nil))[:32], nil
}

// Service returns one service by name.
func (c *Compose) Service(name string) (Service, bool) {
	for _, s := range c.Services {
		if s.Name == name {
			return s, true
		}
	}
	return Service{}, false
}

// Gated reports whether a profile has to be asked for before compose will start
// this service.
func (s Service) Gated() bool { return len(s.Profiles) > 0 }

// ComposeVersion reports what docker compose is on this machine, for the boot
// record. Empty when compose is not installed.
func ComposeVersion(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, "docker", "compose", "version", "--short").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

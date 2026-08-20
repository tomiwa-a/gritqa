package sandbox

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type volume struct {
	host      string
	container string
}

// MakeWritable gives the app somewhere to write. The source is mounted read-only,
// so each run.sandbox.writable directory becomes a volume GritQA owns instead: an
// upload lands in its temp dir and the user's tree is never touched.
//
// They start empty on purpose. A baseline that counted whatever happened to be in
// api/uploads would differ between machines and between runs, and the ledger's
// claim is that two runs of an unchanged project read the same.
func (s *Sandbox) MakeWritable() error {
	work := containerPath("/app", s.recipe.Workdir)
	for _, d := range s.recipe.Writable {
		rel := strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(d)), "./")
		if rel == "" || strings.HasPrefix(rel, "../") || strings.HasPrefix(rel, "/") {
			return fmt.Errorf("run.sandbox.writable: %q has to be a directory inside the project", d)
		}
		host := filepath.Join(s.dir, "writable", filepath.FromSlash(rel))
		if err := os.MkdirAll(host, 0o755); err != nil {
			return err
		}
		s.volumes = append(s.volumes, volume{host: host, container: containerPath(work, rel)})
		s.Watch(host)
	}
	return nil
}

func (s *Sandbox) volumeArgs() []string {
	out := make([]string, 0, len(s.volumes)*2)
	for _, v := range s.volumes {
		out = append(out, "-v", v.host+":"+v.container)
	}
	return out
}

// containerArgs is what every container in this run shares: the project mounted
// read-only, the run's own network, the dependencies the build installed, and the
// directories GritQA owns in place of the user's tree.
func (s *Sandbox) containerArgs(envFile string) []string {
	r := s.recipe
	args := []string{
		"--label", "gritqa=1",
		"--env-file", envFile,
		"-v", r.Mount + ":/app:ro",
		"-w", containerPath("/app", r.Workdir),
	}
	if s.network != "" {
		args = append(args, "--network", s.network)
	}
	// An anonymous volume, so the dependencies the build installed win over
	// whatever the read-only source holds at that path.
	if deps := r.depsPath(); deps != "" {
		args = append(args, "-v", deps)
	}
	args = append(args, s.volumeArgs()...)
	if u := containerUser(); u != "" {
		args = append(args, "--user", u)
	}
	return args
}

// containerEnvFile keeps every value out of argv, where ps would show it. The
// sandbox is written last, so a DB_HOST the user configured cannot point a run at
// their real database. An env file has no quoting, so a value spanning lines is
// refused rather than mangled.
func (s *Sandbox) containerEnvFile(name string, extra ...map[string]string) (string, error) {
	env := map[string]string{}
	for _, m := range extra {
		for k, v := range m {
			env[k] = v
		}
	}
	for k, v := range s.ContainerEnv() {
		env[k] = v
	}

	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, k := range keys {
		if strings.ContainsAny(env[k], "\n\r") {
			return "", fmt.Errorf("%s spans more than one line, which cannot be passed to a container", k)
		}
		fmt.Fprintf(&b, "%s=%s\n", k, env[k])
	}
	path := filepath.Join(s.dir, "env-"+name)
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

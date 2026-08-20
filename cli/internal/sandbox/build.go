package sandbox

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Build renders the recipe and builds it, tagged by fingerprint so an unchanged
// environment costs one image inspect. Mirrors pull(): ask docker whether it
// already has this, and only fetch or build when it does not.
func (s *Sandbox) Build(ctx context.Context, r Recipe) (string, error) {
	tag := "gritqa-app:" + r.Fingerprint
	if _, err := s.docker(ctx, "image", "inspect", tag); err == nil {
		return tag, nil
	}

	body, err := r.Dockerfile()
	if err != nil {
		return "", err
	}

	dir, file, err := s.buildContext(r, body)
	if err != nil {
		return "", err
	}

	s.log("building the environment for this run, which happens once per change")
	args := []string{"build", "-t", tag, "-f", file}
	if r.Base != "" {
		// The base image may be newer upstream than the layer cache; leave that to
		// the user's own docker pull rather than forcing it on every build.
		args = append(args, "--pull=false")
	}
	if _, err := s.docker(ctx, append(args, dir)...); err != nil {
		return "", fmt.Errorf("could not build the environment: %w", err)
	}
	return tag, nil
}

// buildContext keeps the context as small as it can be. With no install there is
// nothing to copy, so the context is an empty directory; with one, it is the
// manifests alone rather than the whole project. A user's own Dockerfile is the
// exception — it may COPY anything, so it gets the mount root.
func (s *Sandbox) buildContext(r Recipe, body string) (dir, file string, err error) {
	if r.File != "" {
		return r.Mount, r.File, nil
	}

	dir = filepath.Join(s.dir, "build-"+r.Fingerprint)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	file = filepath.Join(dir, "Dockerfile")
	if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
		return "", "", err
	}

	if r.Install != "" {
		if err := copyManifests(filepath.Join(r.Mount, r.Installdir), dir); err != nil {
			return "", "", err
		}
	}
	return dir, file, nil
}

func copyManifests(from, to string) error {
	for _, name := range envFiles {
		if name == "Dockerfile" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(from, name))
		if err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(to, name), b, 0o600); err != nil {
			return err
		}
	}
	return nil
}

// RemoveImage drops a built image. Not called on teardown — an image is the
// cache, and rebuilding it every run would defeat the fingerprint — so this is
// for a caller that explicitly wants the disk back.
func (s *Sandbox) RemoveImage(ctx context.Context, tag string) error {
	if strings.TrimSpace(tag) == "" {
		return nil
	}
	_, err := s.docker(ctx, "image", "rm", "-f", tag)
	return err
}

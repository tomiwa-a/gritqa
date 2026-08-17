// Package gitinfo reads repository state by shelling out to git. Absence of git
// is not fatal: the indexer falls back to content hashes alone.
package gitinfo

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

type State struct {
	Branch string
	Head   string
	Dirty  []string
}

var ErrNoGit = errors.New("not a git repository")

func Read(ctx context.Context, root string) (*State, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return nil, ErrNoGit
	}
	if out, err := run(ctx, root, "rev-parse", "--is-inside-work-tree"); err != nil || out != "true" {
		return nil, ErrNoGit
	}

	s := &State{}
	if b, err := run(ctx, root, "rev-parse", "--abbrev-ref", "HEAD"); err == nil && b != "HEAD" {
		s.Branch = b
	}
	if h, err := run(ctx, root, "rev-parse", "--short", "HEAD"); err == nil {
		s.Head = h
	}
	if out, err := run(ctx, root, "status", "--porcelain"); err == nil && out != "" {
		for _, line := range strings.Split(out, "\n") {
			if len(line) > 3 {
				s.Dirty = append(s.Dirty, strings.TrimSpace(line[3:]))
			}
		}
	}
	return s, nil
}

// DefaultBranch reports origin's HEAD, falling back to the current branch.
func DefaultBranch(ctx context.Context, root string) string {
	if out, err := run(ctx, root, "symbolic-ref", "refs/remotes/origin/HEAD"); err == nil {
		if i := strings.LastIndex(out, "/"); i >= 0 {
			return out[i+1:]
		}
	}
	if b, err := run(ctx, root, "rev-parse", "--abbrev-ref", "HEAD"); err == nil && b != "HEAD" {
		return b
	}
	return "main"
}

func RemoteURL(ctx context.Context, root string) string {
	out, err := run(ctx, root, "remote", "get-url", "origin")
	if err != nil {
		return ""
	}
	return out
}

func run(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/gitinfo"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

// Init scaffolds .gritqa/config.yaml for a project that has none: the compose
// files it finds, and every service in them with a blank verdict. It refuses a
// project that is already initialized — that is what update is for — and a
// project with no compose file, because verdicts about nothing boot nothing.
func Init(ctx context.Context, w *term.Writer) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	root, hasConfig, err := config.Find(cwd)
	if err != nil {
		return err
	}
	if hasConfig {
		return fmt.Errorf("this project is already initialized — run gritqa --update "+
			"to refresh it")
	}

	files := sandbox.LocateCompose(root, sandbox.MountRoot(root, ""), nil)
	if len(files) == 0 {
		return fmt.Errorf("no compose file found at %s or above it — gritqa boots a project "+
			"the way its own compose file says to", root)
	}
	c, err := sandbox.ReadCompose(ctx, files)
	if err != nil {
		return err
	}

	rel := make([]string, len(files))
	for i, f := range files {
		rel[i] = filepath.ToSlash(mustRel(root, f))
	}
	cfg := config.New(root, gitinfo.DefaultBranch(ctx, root))
	cfg.Run = &config.Run{
		Sandbox: &config.Sandbox{
			Compose:  rel,
			Services: blankServices(c.Names()),
		},
	}
	if err := cfg.Save(); err != nil {
		return fmt.Errorf("could not write %s: %w", filepath.Join(config.Dir, config.Name), err)
	}

	w.Write(term.Line{Kind: term.OK, Text: fmt.Sprintf("wrote %s", filepath.Join(config.Dir, config.Name))})
	w.Write(term.Line{Kind: term.Out, Text: "judge every service, then run again:"})
	for _, name := range c.Names() {
		w.Write(term.Line{Kind: term.Tree, Text: fmt.Sprintf("%s: role blank — tested, support, schema, on_demand or ignore", name)})
	}
	w.Write(term.Line{Kind: term.Info, Text: "an ignored service needs a reason, and a kept service " +
		"may not need an ignored one"})
	return nil
}

// Update refreshes an initialized project: branch renames are picked up, added
// services arrive with blank verdicts that block the boot, and removed services
// are dropped with a warning rather than an error — removing something is
// tidying, and punishing tidying trains people to leave dead entries around.
// Verdicts on services that are still there are never touched.
func Update(ctx context.Context, w *term.Writer) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	root, hasConfig, err := config.Find(cwd)
	if err != nil {
		return err
	}
	if !hasConfig {
		return fmt.Errorf("nothing initialized here yet — run gritqa --init first")
	}
	cfg, err := config.Load(root)
	if err != nil {
		return err
	}

	if branch := gitinfo.DefaultBranch(ctx, root); branch != "" && branch != cfg.Branch {
		w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("branch %s, was %s",
			branch, cfg.Branch)})
		cfg.Branch = branch
	}

	if cfg.Run == nil || cfg.Run.Sandbox == nil {
		w.Write(term.Line{Kind: term.Info, Text: "no sandbox configured — nothing to refresh"})
		return nil
	}
	sb := cfg.Run.Sandbox

	files := sandbox.LocateCompose(root, sandbox.MountRoot(root, sb.Mount), sb.Compose)
	if len(files) == 0 {
		return fmt.Errorf("the compose files this project pointed at are gone: %s",
			strings.Join(sb.Compose, ", "))
	}
	c, err := sandbox.ReadCompose(ctx, files)
	if err != nil {
		return err
	}

	live := map[string]bool{}
	for _, name := range c.Names() {
		live[name] = true
	}
	if sb.Services == nil {
		sb.Services = map[string]config.Service{}
	}
	added, dropped := refreshServices(sb.Services, live)

	if err := cfg.Save(); err != nil {
		return fmt.Errorf("could not write %s: %w", filepath.Join(config.Dir, config.Name), err)
	}
	for _, name := range dropped {
		w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("%s is gone from the compose file — dropping its verdict", name)})
	}
	for _, name := range added {
		w.Write(term.Line{Kind: term.Info, Text: fmt.Sprintf("%s is new — judge it before anything boots", name)})
	}
	if len(added) == 0 && len(dropped) == 0 {
		w.Write(term.Line{Kind: term.OK, Text: "already current"})
	}
	return nil
}

func blankServices(names []string) map[string]config.Service {
	out := make(map[string]config.Service, len(names))
	for _, name := range names {
		out[name] = config.Service{}
	}
	return out
}

// refreshServices diffs stored verdicts against the compose file's services:
// added services arrive blank (blocking), removed ones are dropped with their
// names reported, and everything that survived keeps its verdict untouched.
func refreshServices(stored map[string]config.Service, live map[string]bool) (added, dropped []string) {
	for name := range stored {
		if !live[name] {
			dropped = append(dropped, name)
			delete(stored, name)
		}
	}
	for name := range live {
		if _, ok := stored[name]; !ok {
			added = append(added, name)
			stored[name] = config.Service{}
		}
	}
	sort.Strings(added)
	sort.Strings(dropped)
	return added, dropped
}

func mustRel(root, f string) string {
	if rel, err := filepath.Rel(root, f); err == nil {
		return rel
	}
	return f
}

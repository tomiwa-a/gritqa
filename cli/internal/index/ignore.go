package index

import (
	"context"
	"errors"
	"os/exec"
	"path"
	"strings"
	"time"
)

// ErrIgnored is a file the project itself excluded. It is not a missing file and
// not a permission problem: the developer said this one is not part of the
// project, and a model reading it anyway is the boundary failing.
var ErrIgnored = errors.New("the project's ignore rules exclude it")

// Readable is the one boundary on reading a file. The file list already honours
// .gitignore, .git/info/exclude and the user's global excludes, because it comes
// from git; a read that only checks the repository root is a second, wider
// boundary on the same tree, and the gap between them is where a gitignored .env
// holding live payment keys gets handed to the model.
//
// It is not the file list itself. The list keeps only application source, and an
// agent working out how a project boots has every reason to read compose.yaml or
// a .csproj. Ignored is the rule; unparseable is not.
func Readable(ctx context.Context, root, rel string) error {
	rel = strings.TrimPrefix(path.Clean(rel), "./")
	if allowed(rel) {
		return nil
	}
	if secretish(rel) {
		return ErrIgnored
	}
	if ignored(ctx, root, rel) {
		return ErrIgnored
	}
	return nil
}

// allowed is the exception list, and it is short on purpose. GritQA's own
// directory describes how GritQA runs rather than what the project holds, and a
// sample env file exists to be read -- it is the one place the variable names
// live without the values.
func allowed(rel string) bool {
	if dir, _ := path.Split(rel); dir == ".gritqa/" {
		switch path.Ext(rel) {
		case ".yaml", ".yml", ".json":
			return true
		}
	}
	return sample(path.Base(rel))
}

func sample(base string) bool {
	for _, suffix := range []string{".example", ".sample", ".template", ".dist"} {
		if strings.HasSuffix(base, suffix) {
			return true
		}
	}
	return false
}

// secretish is the floor under the ignore rules, and it holds whether or not git
// answers. A project with no repository has no .gitignore to honour and its .env
// is still the first file it would have listed; a project that committed one by
// mistake has no rule excluding it at all.
func secretish(rel string) bool {
	base := strings.ToLower(path.Base(rel))
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return true
	}
	switch base {
	case ".netrc", ".npmrc", ".pgpass", "id_rsa", "id_ed25519", "credentials", "secrets.json":
		return true
	}
	switch path.Ext(base) {
	case ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks":
		return true
	}
	return false
}

// ignored asks git, which is the same authority the file list uses. A repository
// git cannot read excludes nothing, which is the honest answer: there are no
// rules to apply, and secretish above is what still holds.
func ignored(ctx context.Context, root, rel string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "check-ignore", "-q", "--", rel)
	cmd.Dir = root
	if err := cmd.Run(); err == nil {
		return true
	}
	// Exit 1 is "not ignored"; anything else is git failing to answer at all.
	return false
}

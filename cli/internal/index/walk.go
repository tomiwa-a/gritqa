// Package index reads the project: which files exist, what changed since last
// time, and which endpoints they register.
package index

import (
	"context"
	"io/fs"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxFileSize = 1 << 20

// list returns candidate paths, repo-relative and slash-separated. Git's own
// view of the repository is preferred, because it honours .gitignore,
// .git/info/exclude and the user's global excludes exactly.
func list(ctx context.Context, root string) ([]string, error) {
	if paths, err := gitList(ctx, root); err == nil {
		return paths, nil
	}
	return walkList(root)
}

func gitList(ctx context.Context, root string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var paths []string
	for _, p := range strings.Split(string(out), "\x00") {
		if p != "" && !skipped(p) {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func walkList(root string) ([]string, error) {
	var paths []string

	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}

		if d.IsDir() {
			if skipDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if !skipped(rel) {
			paths = append(paths, rel)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Strings(paths)
	return paths, nil
}

func skipped(p string) bool {
	for _, seg := range strings.Split(path.Dir(p), "/") {
		if skipDirs[seg] {
			return true
		}
	}
	return Language(p) == ""
}

var skipDirs = map[string]bool{
	".git": true, ".gritqa": true, ".next": true, ".venv": true, ".idea": true,
	".vscode": true, "node_modules": true, "vendor": true, "dist": true,
	"build": true, "target": true, "coverage": true, "__pycache__": true,
	"venv": true, "third_party": true,
	// .NET build output, which holds generated .cs the walker would otherwise
	// index as a second copy of the API. git already excludes it; this is for the
	// fallback walk, where there is no .gitignore to read.
	"obj": true, "bin": true,
}

// Language names the language of a source file, or "" for anything that is not
// application code. Endpoint discovery has no use for config or lockfiles, and
// they would inflate the file count the dashboard shows.
func Language(p string) string {
	return languages[strings.ToLower(filepath.Ext(p))]
}

var languages = map[string]string{
	".go":   "go",
	".js":   "javascript",
	".jsx":  "javascript",
	".mjs":  "javascript",
	".cjs":  "javascript",
	".ts":   "typescript",
	".tsx":  "typescript",
	".py":   "python",
	".rb":   "ruby",
	".java": "java",
	".kt":   "kotlin",
	".php":  "php",
	".rs":   "rust",
	".cs":   "csharp",
	".sql":  "sql",
}

package index

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The measured hole: LoanApp's .env is correctly absent from the file list, and
// read_file returned it anyway, live payment and tunnel secrets included.
func TestAGitignoredFileIsNotReadable(t *testing.T) {
	root := repo(t, map[string]string{
		".gitignore":       "obj/\n*.local.yaml\nnotes.txt\n",
		".env":             "PAYSTACK_SECRET_KEY=sk_live_x\n",
		"notes.txt":        "scratch",
		"app.local.yaml":   "port: 8080\n",
		"obj/Generated.cs": "class G {}\n",
		"Program.cs":       "class P {}\n",
		"compose.yaml":     "services: {}\n",
	})

	for _, p := range []string{".env", "notes.txt", "app.local.yaml", "obj/Generated.cs"} {
		if err := Readable(context.Background(), root, p); err == nil {
			t.Errorf("%s is readable, want it refused", p)
		}
	}
	// Not source, not ignored, and exactly what an agent working out how the
	// project boots needs. The rule is the ignore list, not the file list.
	for _, p := range []string{"Program.cs", "compose.yaml", ".gitignore"} {
		if err := Readable(context.Background(), root, p); err != nil {
			t.Errorf("%s: %v, want it readable", p, err)
		}
	}
}

// A sample env file is the one place the variable names exist without the values,
// so it is the file an agent should read rather than the one it should not.
func TestTheExceptionsAreReadable(t *testing.T) {
	root := repo(t, map[string]string{
		".gitignore":            ".env*\n.gritqa/\n",
		".env.example":          "PAYSTACK_SECRET_KEY=\n",
		".gritqa/config.yaml":   "project: x\n",
		".gritqa/cache.db":      "binary",
		".env.production.local": "PAYSTACK_SECRET_KEY=sk_live_x\n",
	})

	for _, p := range []string{".env.example", ".gritqa/config.yaml"} {
		if err := Readable(context.Background(), root, p); err != nil {
			t.Errorf("%s: %v, want it readable", p, err)
		}
	}
	for _, p := range []string{".env.production.local", ".gritqa/cache.db"} {
		if err := Readable(context.Background(), root, p); err == nil {
			t.Errorf("%s is readable, want it refused", p)
		}
	}
}

// A project with no repository has no rules to honour, and its .env is still the
// first file that must not be read.
func TestSecretsAreRefusedWithoutAGitRepo(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{".env", "server.key", "id_rsa"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := Readable(context.Background(), root, name); err == nil {
			t.Errorf("%s is readable with no git, want it refused", name)
		}
	}
}

func repo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, body := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = root
	if err := cmd.Run(); err != nil {
		t.Skipf("no git: %v", err)
	}
	return root
}

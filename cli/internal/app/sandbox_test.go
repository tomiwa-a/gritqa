package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
)

// The block handed back for approval has to be one Load accepts, or the human
// pastes it and the next run still says nothing knows how this project boots.
func TestTheBlockThatApprovesAProposalLoads(t *testing.T) {
	want := sandbox.Environment{
		App: "app", Port: 8080, Database: "db", DBPort: 3306, Driver: "mysql",
		Login:    sandbox.Login{User: "$MYSQL_USER", Password: "$MYSQL_PASSWORD", Name: "$MYSQL_DATABASE"},
		Schema:   []sandbox.SchemaStep{{Service: "migrate"}, {Service: "app", Run: []string{"sh", "-c", "seed"}}},
		Writable: []string{"/app/api/uploads"},
		Author:   sandbox.AuthorConfig,
	}
	block := config.EnvironmentBlock(toConfig(want))

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, config.Dir), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, config.Dir, config.Name)
	if err := os.WriteFile(path, []byte("project: hotel-api\n"+block), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.Load(root)
	if err != nil {
		t.Fatalf("the block does not load: %v\n%s", err, block)
	}
	e := cfg.Run.SandboxOpts().Environment
	if e == nil {
		t.Fatalf("the block loaded and set no environment:\n%s", block)
	}
	if got := fromConfig(*e); !reflect.DeepEqual(got, want) {
		t.Errorf("the block round-trips to\n%+v\nwant\n%+v\nfrom\n%s", got, want, block)
	}
	if len(cfg.Retired()) != 0 {
		t.Errorf("the block uses keys nothing reads: %v", cfg.Retired())
	}
}

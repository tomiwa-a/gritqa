package app

import (
	"reflect"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
)

// The verdicts a human writes have to be the verdicts a boot reads, or the
// config is decoration. Services in, classifications out, through a save and
// a load so the YAML shape is covered too.
func TestServiceVerdictsBecomeTheBootEnvironment(t *testing.T) {
	root := t.TempDir()
	cfg := config.New(root, "main")
	cfg.Run = &config.Run{
		Sandbox: &config.Sandbox{
			Compose:  []string{"compose.yaml"},
			Egress:   "deny",
			Writable: []string{"/app/api/uploads"},
			Services: map[string]config.Service{
				"app":    {Role: "tested", Port: 8080},
				"db":     {Role: "support", Port: 3306, Measure: "sql", Driver: "mysql"},
				"migrate": {Role: "schema"},
				"seed":   {Role: "schema", Run: []string{"sh", "-c", "seed"}},
				"tunnel": {Role: "ignore", Why: "reaches live infra"},
			},
		},
	}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}

	loaded, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	got := fromConfig(*loaded.Run.Sandbox)

	want := sandbox.Environment{
		Author:   sandbox.AuthorConfig,
		Egress:   "deny",
		Writable: []string{"/app/api/uploads"},
		Services: []sandbox.Classification{
			{Service: "app", Role: sandbox.RoleTested, Port: 8080},
			{Service: "db", Role: sandbox.RoleSupport, Port: 3306, Measure: sandbox.MeasureSQL, Driver: "mysql"},
			{Service: "migrate", Role: sandbox.RoleSchema},
			{Service: "seed", Role: sandbox.RoleSchema, Run: []string{"sh", "-c", "seed"}},
			{Service: "tunnel", Role: sandbox.RoleIgnore, Why: "reaches live infra"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("config became\n%+v\nwant\n%+v", got, want)
	}
	if len(loaded.Retired()) != 0 {
		t.Errorf("a config of only live keys reports %v as retired", loaded.Retired())
	}
}

// The regression that bit: Check normalizes a throwaway copy for itself, so
// validating without normalizing the boot path approves on a phantom while the
// launch maps ports for an empty app. environment() must return verdicts AND
// the derived flat fields, together.
func TestEnvironmentReturnsWhatValidationApproved(t *testing.T) {
	cfg := config.New(t.TempDir(), "main")
	cfg.Run = &config.Run{
		Sandbox: &config.Sandbox{
			Services: map[string]config.Service{
				"api": {Role: "tested", Port: 80},
				"db":  {Role: "support"},
			},
		},
	}
	comp := &sandbox.Compose{
		Files: []string{"compose.yaml"},
		Services: []sandbox.Service{
			{Name: "api"},
			{Name: "db"},
		},
	}

	env, err := environment(cfg, comp)
	if err != nil {
		t.Fatalf("valid verdicts refused: %v", err)
	}
	if env.App != "api" || env.Port != 80 {
		t.Errorf("boot would map %q on %d — validation approved api on 80", env.App, env.Port)
	}
}

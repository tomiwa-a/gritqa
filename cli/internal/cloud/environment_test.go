package cloud

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/sandbox"
)

// The one thing that must never travel. Compose expands ${MYSQL_ROOT_PASSWORD} to
// the real password, and a compose file can write one in literally too -- so the
// push carries variable names and nothing else. Failing this test means somebody's
// secret is being copied into a database over the network.
func TestDeclaredSendsNamesAndNotValues(t *testing.T) {
	push := Declared("machine", &sandbox.Compose{
		Name:        "loanapp",
		Fingerprint: "abc123",
		Files:       []string{"compose.yaml"},
		Services: []sandbox.Service{{
			Name:  "database",
			Image: "mysql:8",
			Environment: map[string]string{
				"MYSQL_ROOT_PASSWORD": "s3cr3t-from-dot-env",
				"MYSQL_DATABASE":      "loanapp",
			},
			Ports: []sandbox.Port{{Container: 3306, Published: "3307", Protocol: "tcp"}},
		}},
	})

	body, err := json.Marshal(push)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "s3cr3t-from-dot-env") {
		t.Fatalf("the push carries a value out of the compose file: %s", body)
	}
	env := push.Services[0].Env
	if len(env) != 2 || env[0] != "MYSQL_DATABASE" || env[1] != "MYSQL_ROOT_PASSWORD" {
		t.Fatalf("env = %v, want both names, sorted", env)
	}
	if push.Services[0].Ports[0].Published != "3307" {
		t.Fatalf("ports = %v, want the published port kept", push.Services[0].Ports)
	}
}

// Two pushes of one file have to be the same bytes, or every boot writes a new row
// for a compose file nobody edited.
func TestDeclaredIsStable(t *testing.T) {
	c := &sandbox.Compose{Fingerprint: "f", Services: []sandbox.Service{
		{Name: "zebra"}, {Name: "app"}, {Name: "database"},
	}}
	first, _ := json.Marshal(Declared("m", c))
	second, _ := json.Marshal(Declared("m", c))
	if string(first) != string(second) {
		t.Fatalf("two pushes differ:\n%s\n%s", first, second)
	}
	got := Declared("m", c).Services
	if got[0].Name != "app" || got[2].Name != "zebra" {
		t.Fatalf("services = %v, want them sorted by name", got)
	}
}

// "none" and "proposed" are ordinary answers, and neither is something a boot may
// read: a proposal nobody has looked at booting itself is the whole failure this
// screen exists to stop.
func TestOnlyAnApprovedJudgementBoots(t *testing.T) {
	e := &sandbox.Environment{App: "main", Port: 8080}
	for _, tc := range []struct {
		j    *Judged
		want bool
	}{
		{nil, false},
		{&Judged{Status: "none"}, false},
		{&Judged{Status: "proposed", Environment: e}, false},
		{&Judged{Status: "approved"}, false},
		{&Judged{Status: "approved", Environment: e}, true},
	} {
		if got := tc.j.Approved(); got != tc.want {
			t.Fatalf("%+v approved = %v, want %v", tc.j, got, tc.want)
		}
	}
}

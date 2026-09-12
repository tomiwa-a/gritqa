package sandbox

import (
	"encoding/json"
	"strings"
	"testing"
)

// A file shaped like the one that motivated all of this: an app, its database, a
// migrator, a worker on a schedule, and a tunnel holding a live token.
const rolesDoc = `{
  "name": "loanapp",
  "services": {
    "main":    {"image": "loanapp:dev", "ports": [{"target": 8080, "published": "5000"}],
                "depends_on": {"database": {"condition": "service_healthy"},
                               "migration": {"condition": "service_completed_successfully"}}},
    "database": {"image": "mysql:8", "environment": {"MYSQL_ROOT_PASSWORD": "s3cr3t"},
                 "ports": [{"target": 3306, "published": "3307"}]},
    "migration": {"image": "loanapp:dev", "command": ["dotnet", "migrate"]},
    "jobs":     {"image": "loanapp:dev", "depends_on": ["database", "cloudflared"]},
    "cloudflared": {"image": "cloudflare/cloudflared:latest",
                    "command": ["tunnel", "--no-autoupdate", "run"]}
  }
}`

func rolesCompose() *Compose {
	return &Compose{
		Name:  "loanapp",
		Files: []string{"compose.yaml"},
		Services: []Service{
			{Name: "main", Image: "loanapp:dev"},
			{Name: "database", Image: "mysql:8",
				Environment: map[string]string{"MYSQL_ROOT_PASSWORD": "s3cr3t"}},
			{Name: "migration", Image: "loanapp:dev"},
			{Name: "jobs", Image: "loanapp:dev"},
			{Name: "cloudflared", Image: "cloudflare/cloudflared:latest"},
		},
		raw: []byte(rolesDoc),
	}
}

func classified() Environment {
	return Environment{
		Services: []Classification{
			{Service: "main", Role: RoleTested, Port: 8080},
			{Service: "migration", Role: RoleSchema, Run: []string{"dotnet", "migrate"}},
			{Service: "database", Role: RoleSupport, Measure: MeasureSQL, Port: 3306,
				Driver: "mysql"},
			{Service: "jobs", Role: RoleOnDemand,
				Why: "writes on a two-minute schedule, so it would move rows no step caused"},
			{Service: "cloudflared", Role: RoleIgnore,
				Why: "runs a tunnel against a live token and would publish the copy publicly"},
		},
		Author: AuthorApproved,
	}
}

// The whole mechanism. A service nobody classified is one `docker compose up`
// starts because nothing said otherwise, and on the measured project that service
// was a Cloudflare tunnel. So the boot refuses, and it names what is missing.
func TestAnUnclassifiedServiceRefusesToBoot(t *testing.T) {
	e := classified()
	e.Services = e.Services[:3] // jobs and the tunnel left out

	err := e.Check(rolesCompose())
	if err == nil {
		t.Fatal("four services out of five was accepted")
	}
	for _, want := range []string{"cloudflared", "jobs", "ignore"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want %s named in it", err, want)
		}
	}
}

func TestACompleteClassificationIsAccepted(t *testing.T) {
	if err := classified().Check(rolesCompose()); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

// A kept service that needs an ignored one fails with the chain named: the
// overlay would delete the ignored service and prune the edge, leaving the
// kept one to fail in the copy for a reason nothing in the copy explains.
func TestAKeptServiceMayNotNeedAnIgnoredOne(t *testing.T) {
	c := rolesCompose()
	for i := range c.Services {
		if c.Services[i].Name == "main" {
			c.Services[i].DependsOn = []Need{{Service: "cloudflared", Required: true}}
		}
		if c.Services[i].Name == "jobs" {
			c.Services[i].DependsOn = []Need{{Service: "cloudflared", Required: false}}
		}
	}
	if err := classified().Check(c); err == nil || !strings.Contains(err.Error(), "cloudflared") {
		t.Fatalf("err = %v, want the ignored tunnel named with its dependent", err)
	}

	// Optional edges are exempt: compose starts without them anyway.
	c2 := rolesCompose()
	for i := range c2.Services {
		if c2.Services[i].Name == "main" {
			c2.Services[i].DependsOn = []Need{{Service: "cloudflared", Required: false}}
		}
	}
	if err := classified().Check(c2); err != nil {
		t.Errorf("an optional edge to an ignored service should not fail: %v", err)
	}
}

// Refusing is the one choice that leaves nothing behind to read the reason off:
// the service is gone from the document, so the record is the only place it lives.
func TestARefusalHasToSayWhy(t *testing.T) {
	e := classified()
	for i := range e.Services {
		if e.Services[i].Role == RoleIgnore {
			e.Services[i].Why = "  "
		}
	}
	err := e.Check(rolesCompose())
	if err == nil || !strings.Contains(err.Error(), "cloudflared") {
		t.Fatalf("err = %v, want the refused service named", err)
	}
}

func TestCheckRefusesWhatItCannotAct(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Environment)
		want string
	}{
		{"two under test", func(e *Environment) {
			e.Services[3].Role, e.Services[3].Why = RoleTested, ""
			e.Services[3].Port = 9000
		}, "base URL"},
		{"nothing under test", func(e *Environment) {
			e.Services[0].Role = RoleSupport
		}, "under test"},
		{"a role that is not one", func(e *Environment) {
			e.Services[1].Role = "watched"
		}, "not something GritQA does"},
		{"a service that is not there", func(e *Environment) {
			e.Services[1].Service = "migrations"
		}, "is not a service"},
		{"one service twice", func(e *Environment) {
			e.Services = append(e.Services, Classification{Service: "main", Role: RoleSupport})
		}, "twice"},
		{"measured over nothing known", func(e *Environment) {
			e.Services[2].Measure = "grpc"
		}, "not a way GritQA reads state"},
		{"measured over sql with no driver", func(e *Environment) {
			e.Services[2].Driver = ""
		}, "what it speaks"},
		{"an egress answer that is not one", func(e *Environment) {
			e.Egress = "sometimes"
		}, "reach the internet"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := classified()
			c.edit(&e)
			err := e.Check(rolesCompose())
			if err == nil {
				t.Fatalf("accepted %s", c.name)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("error = %q, want %q in it", err, c.want)
			}
		})
	}
}

// The boot reads App, Database and Schema. Once a classification exists those are
// views onto it, so the two can never disagree.
func TestTheOlderFieldsAreDerivedFromTheClassification(t *testing.T) {
	e := classified().Normalize()

	if e.App != "main" || e.Port != 8080 {
		t.Errorf("app = %s on %d, want main on 8080", e.App, e.Port)
	}
	if e.Database != "database" || e.DBPort != 3306 || e.Driver != "mysql" {
		t.Errorf("datastore = %s on %d over %s", e.Database, e.DBPort, e.Driver)
	}
	if len(e.Schema) != 1 || e.Schema[0].Service != "migration" {
		t.Errorf("schema = %+v, want the migrator", e.Schema)
	}
	if !e.Watched() {
		t.Error("a mysql store with a client compiled in is watchable")
	}

	// Running it twice must not append the schema step a second time.
	if again := e.Normalize(); len(again.Schema) != 1 {
		t.Errorf("normalizing twice gave %d schema steps", len(again.Schema))
	}
}

// An environment written before roles existed has to keep booting exactly as it
// did, or every project on disk breaks the day this ships.
func TestNoClassificationLeavesTheOlderFieldsAlone(t *testing.T) {
	e := Environment{App: "main", Port: 8080, Database: "database", DBPort: 3306,
		Driver: "mysql", Schema: []SchemaStep{{Service: "migration"}}}

	got := e.Normalize()
	if got.App != "main" || got.Database != "database" || len(got.Schema) != 1 {
		t.Errorf("normalize rewrote an unclassified environment: %+v", got)
	}
	if err := got.Check(rolesCompose()); err != nil {
		t.Fatalf("Check refused the shape that boots today: %v", err)
	}
	if got.Ignored() != nil || got.OnDemand() != nil {
		t.Error("an unclassified environment refuses and holds back nothing")
	}
}

// Nothing said is denied. The safe answer has to be the one you get by not
// thinking about it.
func TestEgressIsDeniedUnlessItIsAsked(t *testing.T) {
	if !(Environment{}).Denied() {
		t.Error("an environment that says nothing about egress allowed it")
	}
	if !(Environment{Egress: EgressDeny}).Denied() {
		t.Error("deny did not deny")
	}
	if (Environment{Egress: EgressAllow}).Denied() {
		t.Error("allow did not allow")
	}
}

func roled(t *testing.T, e Environment) (*Overlay, map[string]any) {
	t.Helper()
	got, err := rolesCompose().Overlay(e, "gritqa-loan")
	if err != nil {
		t.Fatalf("Overlay: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(got.Document, &doc); err != nil {
		t.Fatalf("unreadable document: %v", err)
	}
	return got, doc
}

// A refused service is deleted rather than disabled, so nothing downstream has to
// read a flag correctly for the safety property to hold.
func TestARefusedServiceIsNotInTheDocument(t *testing.T) {	got, doc := roled(t, classified().Normalize())

	services := doc["services"].(map[string]any)
	if _, ok := services["cloudflared"]; ok {
		t.Error("the tunnel is still in the document GritQA boots")
	}
	if !contains(got.Ignored, "cloudflared") {
		t.Errorf("Ignored = %v, want the tunnel named", got.Ignored)
	}
	if strings.Contains(string(got.Document), "cloudflared") {
		t.Error("the document still mentions the tunnel somewhere")
	}
}

// A schema runner that also starts on `up` executes twice per boot — once
// unobserved, once as the step — and the first execution's leftover state is
// what the second one trips over. So schema services park behind the hold
// profile like on-demand ones: out of the boot, runnable by explicit step.
func TestSchemaServicesParkOutOfTheBoot(t *testing.T) {
	got, doc := roled(t, classified().Normalize())

	services := doc["services"].(map[string]any)
	migration, ok := services["migration"].(map[string]any)
	if !ok {
		t.Fatal("the migrator is gone from the document entirely")
	}
	profiles, _ := migration["profiles"].([]any)
	if len(profiles) != 1 || profiles[0] != HoldProfile {
		t.Errorf("migration profiles = %v, want only the hold profile", profiles)
	}
	if !contains(got.Held, "migration") {
		t.Errorf("Held = %v, want the migrator named", got.Held)
	}
}

// Compose stops on a depends_on it cannot satisfy, so removing a service without
// removing what points at it turns a safety choice into a boot failure.
func TestWhatDependedOnTheAbsentIsDetached(t *testing.T) {
	_, doc := roled(t, classified().Normalize())

	// jobs depended on database and cloudflared, in list form.
	deps := svc(t, doc, "jobs")["depends_on"]
	if !sameJSON(deps, []any{"database"}) {
		t.Errorf("jobs depends_on = %v, want the database alone", deps)
	}
	// main depended on database and migration, in map form. The database edge
	// stays: it boots. The migration edge goes: schema services run as explicit
	// steps, never as part of the boot, so an edge `up` cannot satisfy would
	// only fail it.
	if got := svc(t, doc, "main")["depends_on"].(map[string]any); len(got) != 1 {
		t.Errorf("main depends_on = %v, want the database alone", got)
	}
}

// Held back means still there: `up` skips a profile nothing enables, and `run`
// turns that service's own profiles on, so one key is both halves at once.
func TestAHeldServiceStaysBehindAProfile(t *testing.T) {
	got, doc := roled(t, classified().Normalize())

	if p := svc(t, doc, "jobs")["profiles"]; !sameJSON(p, []any{HoldProfile}) {
		t.Errorf("jobs profiles = %v, want the hold", p)
	}
	if !contains(got.Held, "jobs") {
		t.Errorf("Held = %v, want jobs named", got.Held)
	}
	if p, ok := svc(t, doc, "main")["profiles"]; ok {
		t.Errorf("the app was held back too: %v", p)
	}
}

// The obvious way to deny egress is `internal: true`, and it is the wrong one --
// measured on Docker 28.1.1, an internal network publishes no ports at all, so the
// app under test would be unreachable. Turning the bridge's masquerade off denies
// the outbound packet and leaves the inbound DNAT alone.
func TestDenyingEgressLeavesThePortsPublished(t *testing.T) {
	got, doc := roled(t, classified().Normalize())

	if !got.Sealed {
		t.Fatal("the copy was not sealed")
	}
	nets := doc["networks"].(map[string]any)
	entry, ok := nets["default"].(map[string]any)
	if !ok {
		t.Fatalf("no default network to deny on: %v", nets)
	}
	if entry["internal"] != nil {
		t.Error("internal: true is set, and it would take the published ports with it")
	}
	opts, _ := entry["driver_opts"].(map[string]any)
	if opts["com.docker.network.bridge.enable_ip_masquerade"] != "false" {
		t.Errorf("driver_opts = %v, want masquerade off", opts)
	}
	if p := svc(t, doc, "main")["ports"]; !sameJSON(p, []any{"127.0.0.1::8080"}) {
		t.Errorf("the app publishes %v, and a run reaches it through that", p)
	}
}

func TestAllowingEgressLeavesTheNetworksAlone(t *testing.T) {
	e := classified().Normalize()
	e.Egress = EgressAllow

	got, doc := roled(t, e)
	if got.Sealed {
		t.Error("Sealed with egress allowed")
	}
	if nets, ok := doc["networks"].(map[string]any); ok {
		if entry, ok := nets["default"].(map[string]any); ok {
			if _, sealed := entry["driver_opts"]; sealed {
				t.Errorf("the network was sealed anyway: %v", entry)
			}
		}
	}
}

// A driver this cannot speak for gets left alone: an option Docker does not
// understand is a boot failure, not a safer network.
func TestSealingSkipsADriverItDoesNotKnow(t *testing.T) {
	nets := map[string]any{
		"plain":   map[string]any{},
		"bridged": map[string]any{"driver": "bridge"},
		"woven":   map[string]any{"driver": "macvlan"},
	}
	for name := range nets {
		seal(nets, name)
	}
	for _, name := range []string{"plain", "bridged"} {
		entry := nets[name].(map[string]any)
		if _, ok := entry["driver_opts"]; !ok {
			t.Errorf("%s was not sealed: %v", name, entry)
		}
	}
	if entry := nets["woven"].(map[string]any); entry["driver_opts"] != nil {
		t.Errorf("a macvlan network got bridge options: %v", entry)
	}
}

// An environment written before roles existed must boot the way it boots today,
// which means the overlay changes nothing for it.
func TestAnUnclassifiedEnvironmentBootsUnchanged(t *testing.T) {
	got, doc := roled(t, Environment{App: "main", Port: 8080})

	if got.Sealed || got.Ignored != nil || got.Held != nil {
		t.Errorf("overlay = %+v, want none of the new behaviour", got)
	}
	if _, ok := doc["services"].(map[string]any)["cloudflared"]; !ok {
		t.Error("a service was dropped from an environment that classified nothing")
	}
}

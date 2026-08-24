package sandbox

import (
	"encoding/json"
	"fmt"
	"path"
	"strings"
)

// Environment is what someone worked out about a project's own compose file:
// which service answers HTTP, which one holds the data, how the schema comes up,
// what the app writes to. None of it is derived here. Every field is a judgement
// about someone else's declaration, and this type exists so the judgement can be
// recorded, reviewed and reused rather than made again on every boot.
type Environment struct {
	// App is the compose service that answers HTTP, Port the port inside its
	// container that serves it. GritQA republishes that port on a loopback port of
	// its own, which is what lets a copy run beside the developer's stack.
	App  string `json:"app"`
	Port int    `json:"port"`

	// Database is the service holding the data a run should be measured against,
	// empty when there is none. Driver names what it speaks. Booting the project
	// needs neither: the compose file says how to start a datastore whatever it is.
	// They are here so a run can be measured, and a driver this build has no client
	// for costs the ledger rather than the boot.
	Database string `json:"database,omitempty"`
	DBPort   int    `json:"db_port,omitempty"`
	Driver   string `json:"driver,omitempty"`
	Login    Login  `json:"login"`

	// Schema is how the database gets its structure and its data, in order. Empty
	// is an answer: a project can have nothing to migrate yet.
	Schema []SchemaStep `json:"schema,omitempty"`

	// Writable are absolute paths inside the app's container that it writes to.
	// The source is mounted read-only and a volume goes over each of these, so an
	// upload lands in GritQA's copy instead of the developer's tree.
	Writable []string `json:"writable,omitempty"`

	// Services is every service the compose file declares, with what GritQA does
	// with each one. Empty means nobody classified anything and the fields above
	// are the whole answer, which is how an environment written before roles
	// existed keeps booting. Non-empty means complete: a list that names four
	// services out of five is worse than no list, because the fifth is started by
	// a default nobody chose.
	Services []Classification `json:"services,omitempty"`

	// Egress is whether the copy may reach the internet, and the default is no.
	// Deny is applied to the networks the copy creates rather than to any one
	// service, so a service misclassified as support still cannot phone home.
	Egress string `json:"egress,omitempty"`

	Author string `json:"author"`
	// Fingerprint is the compose fingerprint this was worked out from. When it no
	// longer matches, the environment describes a file that has since changed.
	Fingerprint string `json:"fingerprint,omitempty"`
	Why         string `json:"why,omitempty"`
}

// Login names how to connect by naming keys rather than values. A field starting
// with $ means: read that key from the database service's environment once the
// stack is up. GritQA resolves it at boot, so a password that arrived from .env
// never has to travel to whoever wrote this down.
type Login struct {
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
	Name     string `json:"name,omitempty"`
}

// SchemaStep is one step of bringing the schema up. An empty Run means the
// service's own declared command, which is what a one-shot runner behind a profile
// usually is.
type SchemaStep struct {
	Service string   `json:"service"`
	Run     []string `json:"run,omitempty"`
}

// Check is shape, not judgement: that the services named exist and that the paths
// are container paths. Whether the right service was picked is not checkable here
// and is not checked, and neither is whether GritQA can speak to what was named --
// a project brings up whatever its compose file declares, and what GritQA can read
// afterwards is a separate, smaller question.
func (e Environment) Check(c *Compose) error {
	if c == nil {
		return fmt.Errorf("there is no compose file to read this against")
	}
	if len(e.Services) > 0 {
		if err := e.checkServices(c); err != nil {
			return err
		}
		// Everything below reads the older fields, and once a classification exists
		// those are derived from it. Checking the raw record would be checking
		// something no boot ever sees.
		e = e.Normalize()
	}
	app, ok := c.Service(e.App)
	if !ok {
		return fmt.Errorf("%q is not a service in %s — it declares %s",
			e.App, strings.Join(c.Files, ", "), strings.Join(c.Names(), ", "))
	}
	if e.Port < 1 || e.Port > 65535 {
		return fmt.Errorf("%d is not a port %s could be serving on", e.Port, app.Name)
	}

	for _, p := range e.Writable {
		if !path.IsAbs(p) || p == "/" || strings.Contains(p, "..") {
			return fmt.Errorf("%q is not a path inside a container — writable takes absolute "+
				"container paths, the ones the app itself writes to", p)
		}
	}

	for _, s := range e.Schema {
		if _, ok := c.Service(s.Service); !ok {
			return fmt.Errorf("the schema step %q names no service in %s",
				s.Service, strings.Join(c.Files, ", "))
		}
	}

	if e.Database == "" {
		if e.Driver != "" || e.DBPort != 0 {
			return fmt.Errorf("a driver and a port with no database service to reach — " +
				"name the service, or leave all three empty and GritQA will not watch any data")
		}
		return nil
	}
	db, ok := c.Service(e.Database)
	if !ok {
		return fmt.Errorf("%q is not a service in %s — it declares %s",
			e.Database, strings.Join(c.Files, ", "), strings.Join(c.Names(), ", "))
	}
	if e.DBPort < 1 || e.DBPort > 65535 {
		return fmt.Errorf("%d is not a port %s could be listening on", e.DBPort, db.Name)
	}
	if e.Driver == "" {
		return fmt.Errorf("%s is named as the datastore and nothing says what it speaks — "+
			"name it even if it is something GritQA has no client for, because the record is "+
			"what says what a run was measured against", db.Name)
	}
	for what, ref := range map[string]string{"user": e.Login.User,
		"password": e.Login.Password, "name": e.Login.Name} {
		key, isKey := strings.CutPrefix(ref, "$")
		if !isKey {
			continue
		}
		if _, ok := db.Environment[key]; !ok {
			return fmt.Errorf("login.%s reads $%s, and %s declares no such variable",
				what, key, db.Name)
		}
	}
	return nil
}

// Resolve turns the $KEY references into the values compose resolved. It needs a
// compose read that kept its secrets, because the point is to connect -- so the
// password it comes back with is the developer's, not one GritQA generated, and
// Creds.scrub is what keeps it out of everything reported.
func (e Environment) Resolve(c *Compose) (Creds, error) {
	full, err := c.resolved()
	if err != nil {
		return Creds{}, err
	}
	db, ok := full.Service(e.Database)
	if !ok {
		return Creds{}, fmt.Errorf("%q is no longer a service in this compose file", e.Database)
	}
	out := Creds{}
	for _, f := range []struct {
		what string
		ref  string
		into *string
	}{
		{"user", e.Login.User, &out.User},
		{"password", e.Login.Password, &out.Password},
		{"name", e.Login.Name, &out.Database},
	} {
		key, isKey := strings.CutPrefix(f.ref, "$")
		if !isKey {
			*f.into = f.ref
			continue
		}
		v, ok := db.Environment[key]
		if !ok || v == "" {
			return Creds{}, fmt.Errorf("login.%s reads $%s and %s has no value for it",
				f.what, key, db.Name)
		}
		*f.into = v
	}
	return out, nil
}

// Watched reports whether GritQA can take its own readings from the datastore.
// False is an ordinary outcome, not a failure: the project still boots, and the
// datastore is still queried through the client its own image ships.
func (e Environment) Watched() bool { return e.Database != "" && Linked(e.Driver) }

// Who worked an environment out. None of them is GritQA deciding for itself: the
// config is the developer writing it down, the agent only ever proposes, and
// approved is a person having picked from what the agent proposed.
const (
	AuthorConfig = "config"
	AuthorAgent  = "agent"
	// AuthorApproved is an environment a person approved in the browser. Still not
	// GritQA working one out for itself: the agent proposes, a human picks, and
	// what boots is what the human picked.
	AuthorApproved = "approved"
)

// Describe is the one line a transcript prints about how a run was brought up.
func (e Environment) Describe() string {
	what := fmt.Sprintf("%s on %d", e.App, e.Port)
	switch {
	case e.Watched():
		what += fmt.Sprintf(", %s over %s", e.Database, e.Driver)
	case e.Database != "":
		what += fmt.Sprintf(", %s over %s and read through its own client", e.Database, e.Driver)
	}
	if refused := e.Refused(); len(refused) > 0 {
		what += ", refusing " + strings.Join(refused, " and ")
	}
	if held := e.OnDemand(); len(held) > 0 {
		what += ", holding back " + strings.Join(held, " and ")
	}
	if len(e.Services) > 0 && e.Denied() {
		what += ", no internet"
	}
	switch e.Author {
	case AuthorAgent:
		return what + ", worked out by the agent"
	case AuthorApproved:
		return what + ", as approved in the browser"
	case AuthorConfig:
		return what + ", as configured"
	}
	return what
}

// Stale is an environment worked out from a compose file that has since changed.
// Not wrong -- most edits do not move any of these answers -- but no longer known
// to be right, which is the same distinction a finding carries in M9.
func (e Environment) Stale(c *Compose) bool {
	return c != nil && e.Fingerprint != "" && e.Fingerprint != c.Fingerprint
}

func (e Environment) Encode() (string, error) {
	b, err := json.Marshal(e)
	return string(b), err
}

func DecodeEnvironment(s string) (*Environment, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var e Environment
	if err := json.Unmarshal([]byte(s), &e); err != nil {
		return nil, err
	}
	out := e.Normalize()
	return &out, nil
}

// Role is what GritQA does with one service the compose file declares. Every
// service in the file gets one, because the alternative is what `docker compose
// up` does on its own -- and on one measured project that would have started a
// Cloudflare tunnel holding a live token, publishing GritQA's copy of the app to
// the public internet. There was no way to say no to it.
type Role string

const (
	// RoleTested is the service a run's requests go to. Exactly one.
	RoleTested Role = "tested"
	// RoleSupport is booted and left alone, which is what most services are: a
	// datastore, a cache, a queue the app needs running to work at all.
	RoleSupport Role = "support"
	// RoleSchema is a one-shot. Run in list order before the app counts as up.
	RoleSchema Role = "schema"
	// RoleOnDemand is left out of the boot and started when a step asks for it. A
	// worker on a two-minute schedule writes rows no step caused, which makes the
	// ledger lie; the same worker started by hand is the only way a daily job gets
	// tested at all.
	RoleOnDemand Role = "on_demand"
	// RoleNever is refused: taken out of the document before it reaches Docker, so
	// nothing can start it by accident.
	RoleNever Role = "never"
)

// Roles is the whole vocabulary, in the order a person should read it.
func Roles() []Role {
	return []Role{RoleTested, RoleSupport, RoleSchema, RoleOnDemand, RoleNever}
}

// Measure is how a service's state is read for the ledger, and it is separate
// from Role rather than a kind of one: the service under test is measured on its
// filesystem, a datastore nothing tests is measured on its rows. One field that
// tried to be both is why an environment could only ever name a single database.
type Measure string

const (
	MeasureNone Measure = ""
	// MeasureSQL is a connection GritQA opens itself, with a client compiled in.
	MeasureSQL Measure = "sql"
)

// Egress values. Deny is the default, and it is the default because a copy of
// someone's stack has no business making outbound calls: the third-party keys in
// their .env are real, and a webhook fired from a test run is not a test.
const (
	EgressDeny  = "deny"
	EgressAllow = "allow"
)

// Classification is one service and what GritQA does with it. The fields past Role
// are what acting on that role needs -- a tested service needs the port it serves
// on, a measured datastore needs a login, a schema step needs its command -- and
// each is meaningless for the roles that do not use it.
type Classification struct {
	Service string `json:"service"`
	Role    Role   `json:"role"`

	// Why is required on never and optional elsewhere. A refusal is the one choice
	// that leaves nothing behind to read the reason off: the service is gone from
	// the document, so if the record does not say why, nobody can tell whether it
	// was a safety call or a mistake.
	Why string `json:"why,omitempty"`

	// Port is the container port GritQA publishes for this service: the one the
	// app serves HTTP on, or the one its datastore listens on.
	Port int `json:"port,omitempty"`

	Measure Measure `json:"measure,omitempty"`
	Driver  string  `json:"driver,omitempty"`
	Login   *Login  `json:"login,omitempty"`

	// Run is a schema step's command. Empty means the service's own.
	Run []string `json:"run,omitempty"`
}

// Normalize makes the older fields views onto the classification, so a boot reads
// one answer however it was written down. It is a copy rather than a mutation, and
// running it twice changes nothing the first pass did not.
func (e Environment) Normalize() Environment {
	if len(e.Services) == 0 {
		return e
	}
	out := e
	out.App, out.Port = "", 0
	out.Database, out.DBPort, out.Driver, out.Login = "", 0, "", Login{}
	out.Schema = nil

	for _, s := range e.Services {
		switch s.Role {
		case RoleTested:
			out.App, out.Port = s.Service, s.Port
		case RoleSchema:
			out.Schema = append(out.Schema, SchemaStep{Service: s.Service, Run: s.Run})
		}
		// The first sql-measured store is the one the older fields can hold. A
		// second is not lost -- it is in Services, which is what M4c's stores[]
		// reads -- but it is not what a single Database field can say.
		if s.Measure == MeasureSQL && out.Database == "" {
			out.Database, out.DBPort, out.Driver = s.Service, s.Port, s.Driver
			if s.Login != nil {
				out.Login = *s.Login
			}
		}
	}
	return out
}

// Refused are the services the copy must not start at all, and OnDemand the ones
// it starts only when a step asks. Both are empty for an environment that never
// classified anything, which is what keeps the older shape booting unchanged.
func (e Environment) Refused() []string { return e.playing(RoleNever) }

func (e Environment) OnDemand() []string { return e.playing(RoleOnDemand) }

func (e Environment) playing(r Role) []string {
	var out []string
	for _, s := range e.Services {
		if s.Role == r {
			out = append(out, s.Service)
		}
	}
	return out
}

// Denied reports whether the copy is cut off from the internet. Nothing said is
// denied: the safe answer is the one you get by not thinking about it.
func (e Environment) Denied() bool { return e.Egress != EgressAllow }

// checkServices is completeness, and it only applies once something has
// classified the file. Every service named or the boot refuses: that is the whole
// mechanism, and it is what makes a tunnel impossible to miss rather than
// something you have to know to look for.
func (e Environment) checkServices(c *Compose) error {
	seen := map[string]bool{}
	tested := ""

	for _, s := range e.Services {
		if _, ok := c.Service(s.Service); !ok {
			return fmt.Errorf("%q has a role and is not a service in %s — it declares %s",
				s.Service, strings.Join(c.Files, ", "), strings.Join(c.Names(), ", "))
		}
		if seen[s.Service] {
			return fmt.Errorf("%s is given a role twice, and one service does one thing",
				s.Service)
		}
		seen[s.Service] = true

		switch s.Role {
		case RoleSupport, RoleSchema, RoleOnDemand:
		case RoleTested:
			if tested != "" {
				return fmt.Errorf("%s and %s are both under test, and a run has one base URL "+
					"— whichever the requests go to is tested, the other is support",
					tested, s.Service)
			}
			tested = s.Service
		case RoleNever:
			if strings.TrimSpace(s.Why) == "" {
				return fmt.Errorf("%s is refused and nothing says why — it will be gone from "+
					"the document GritQA boots, so the record is the only place the reason "+
					"can live", s.Service)
			}
		default:
			return fmt.Errorf("%q is not something GritQA does with a service: %s",
				s.Role, list(Roles()))
		}

		switch s.Measure {
		case MeasureNone:
		case MeasureSQL:
			if s.Role == RoleTested {
				return fmt.Errorf("%s is under test and measured over sql, which needs two "+
					"published ports and a service records one", s.Service)
			}
			if s.Driver == "" {
				return fmt.Errorf("%s is measured over sql and nothing says what it speaks",
					s.Service)
			}
			if s.Port < 1 || s.Port > 65535 {
				return fmt.Errorf("%d is not a port %s could be listening on", s.Port, s.Service)
			}
		default:
			return fmt.Errorf("%q is not a way GritQA reads state — sql, or nothing at all "+
				"and the ledger says so", s.Measure)
		}
	}

	var unsaid []string
	for _, name := range c.Names() {
		if !seen[name] {
			unsaid = append(unsaid, name)
		}
	}
	if len(unsaid) > 0 {
		return fmt.Errorf("%s in %s carry no role, and an unclassified service is one "+
			"`docker compose up` starts because nobody said otherwise — say what each one "+
			"is, even if the answer is never", strings.Join(unsaid, ", "),
			strings.Join(c.Files, ", "))
	}
	if tested == "" {
		return fmt.Errorf("nothing in %s is under test — one service answers the requests a "+
			"run makes, and without it there is no base URL to send them to",
			strings.Join(c.Files, ", "))
	}

	switch e.Egress {
	case "", EgressDeny, EgressAllow:
	default:
		return fmt.Errorf("%q is not an answer to whether the copy may reach the internet: "+
			"%s, or %s", e.Egress, EgressDeny, EgressAllow)
	}
	return nil
}

func list(rs []Role) string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = string(r)
	}
	return strings.Join(out, ", ")
}

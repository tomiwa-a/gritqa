package sandbox

import (
	"database/sql"
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

	// Database is the service holding the data GritQA watches, empty when there is
	// none. Driver is what it speaks -- GritQA opens a connection with it to take
	// watermarks and to serve db(sql), so a database it cannot speak to is visible
	// rather than silently unread.
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

// Check is shape, not judgement: that the services named exist, that the paths are
// container paths, and that GritQA can actually speak the driver named. Whether
// the right service was picked is not checkable here and is not checked.
func (e Environment) Check(c *Compose) error {
	if c == nil {
		return fmt.Errorf("there is no compose file to read this against")
	}
	app, ok := c.Service(e.App)
	if !ok {
		return fmt.Errorf("%q is not a service in %s — it declares %s",
			e.App, strings.Join(c.Files, ", "), strings.Join(serviceNames(c), ", "))
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
			e.Database, strings.Join(c.Files, ", "), strings.Join(serviceNames(c), ", "))
	}
	if e.DBPort < 1 || e.DBPort > 65535 {
		return fmt.Errorf("%d is not a port %s could be listening on", e.DBPort, db.Name)
	}
	if !Linked(e.Driver) {
		return fmt.Errorf("GritQA has no %s driver in this build, so it could not read that "+
			"database even once it is up — it speaks %s. Leave the database out and it will run "+
			"the app without watching any data", e.Driver, strings.Join(Drivers(), " and "))
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

// Describe is the one line a transcript prints about how a run was brought up.
func (e Environment) Describe() string {
	what := fmt.Sprintf("%s on %d", e.App, e.Port)
	if e.Database != "" {
		what += fmt.Sprintf(", %s over %s", e.Database, e.Driver)
	}
	switch e.Author {
	case AuthorAgent:
		return what + ", worked out by the agent"
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
	return &e, nil
}

// Linked reports whether this build can both speak that protocol and address it:
// a driver registered with database/sql, and a DSN shape in image.go. Asked of
// database/sql rather than of a table, so linking a driver is most of what it
// takes to support one.
func Linked(driver string) bool {
	for _, d := range Drivers() {
		if d == driver {
			return true
		}
	}
	return false
}

// Drivers is what GritQA can reach a database over, in this build.
func Drivers() []string {
	var out []string
	for _, want := range []Driver{MySQL, Postgres} {
		for _, got := range sql.Drivers() {
			if got == string(want) {
				out = append(out, got)
			}
		}
	}
	return out
}

func serviceNames(c *Compose) []string {
	out := make([]string, 0, len(c.Services))
	for _, s := range c.Services {
		out = append(out, s.Name)
	}
	return out
}

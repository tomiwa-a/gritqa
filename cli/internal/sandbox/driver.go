package sandbox

import (
	"database/sql"
	"fmt"
	"sort"
)

// Driver is a wire protocol this build has a client compiled into it. It is not
// a list of datastores GritQA supports: taking a watermark means running a query,
// running a query means speaking a protocol, and no amount of configuration lets
// Go speak one nothing implements.
//
// Nothing about booting a project reads this. A compose file brings up whatever it
// declares -- Mongo, Kafka, ClickHouse, four of them at once -- and a datastore with
// no entry here is still reachable through the client its own image ships.
type Driver string

const (
	MySQL    Driver = "mysql"
	Postgres Driver = "postgres"
)

// address is why Drivers is not simply sql.Drivers(): a driver registered by some
// other package is still unreachable if nothing here knows how to address it.
// Adding a protocol is this map plus its import, and nothing else.
var address = map[Driver]func(host string, port int, c Creds) string{
	// multiStatements is load-bearing: Restore feeds a whole dump back through
	// this connection.
	MySQL: func(host string, port int, c Creds) string {
		return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&multiStatements=true&timeout=5s",
			c.User, c.Password, host, port, c.Database)
	},
	Postgres: func(host string, port int, c Creds) string {
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
			c.User, c.Password, host, port, c.Database)
	},
}

// DSN is what sql.Open takes, and empty for a protocol this build cannot address.
func (d Driver) DSN(host string, port int, c Creds) string {
	f, ok := address[d]
	if !ok {
		return ""
	}
	return f(host, port, c)
}

// Linked reports whether this build can open its own connection to that protocol.
// It decides how a datastore is read, never whether a project boots.
func Linked(driver string) bool {
	for _, d := range Drivers() {
		if d == driver {
			return true
		}
	}
	return false
}

// Drivers is what this build can connect to itself: registered with database/sql
// and addressable above. Asked of the build rather than declared, so linking a
// client is most of what it takes to add one.
func Drivers() []string {
	var out []string
	for _, got := range sql.Drivers() {
		if _, ok := address[Driver(got)]; ok {
			out = append(out, got)
		}
	}
	sort.Strings(out)
	return out
}

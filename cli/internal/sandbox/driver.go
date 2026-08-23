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

// client is everything this build knows about talking to one protocol: how to
// address it, and how to ask it what it holds. It is why Drivers is not simply
// sql.Drivers() -- a driver registered by some other package is still unreachable
// if nothing here can address it. Adding a protocol is one entry plus its import.
type client struct {
	dsn func(host string, port int, c Creds) string
	// schema is the namespace to read table names from, which is the database for
	// MySQL and a schema within it for Postgres.
	schema func(c Creds) string
	// tables and columns each take the schema as their one argument.
	tables, columns string
	// ident quotes an identifier; text casts an expression to a string, because a
	// high-water mark is compared as text whatever its column type.
	ident, text func(string) string
}

var clients = map[Driver]client{
	MySQL: {
		// multiStatements is load-bearing: Restore feeds a whole dump back through
		// this connection.
		dsn: func(host string, port int, c Creds) string {
			return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&multiStatements=true&timeout=5s",
				c.User, c.Password, host, port, c.Database)
		},
		schema: func(c Creds) string { return c.Database },
		tables: `SELECT TABLE_NAME FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
		columns: `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE,
		 EXTRA LIKE '%auto_increment%', COLUMN_KEY = 'PRI'
		 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
		 ORDER BY TABLE_NAME, ORDINAL_POSITION`,
		ident: func(s string) string { return "`" + s + "`" },
		text:  func(e string) string { return "CAST(" + e + " AS CHAR)" },
	},
	Postgres: {
		dsn: func(host string, port int, c Creds) string {
			return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
				c.User, c.Password, host, port, c.Database)
		},
		schema: func(Creds) string { return "public" },
		tables: `SELECT table_name FROM information_schema.tables
		 WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
		// A serial column is a default of nextval, and an identity column says so
		// outright; both are the same thing to a watermark.
		columns: `SELECT c.table_name, c.column_name, c.data_type,
		   c.is_identity = 'YES' OR COALESCE(c.column_default, '') LIKE 'nextval%',
		   COALESCE(k.is_pk, false)
		 FROM information_schema.columns c
		 LEFT JOIN (
		   SELECT ccu.table_name, ccu.column_name, true AS is_pk
		   FROM information_schema.table_constraints tc
		   JOIN information_schema.constraint_column_usage ccu
		     ON ccu.constraint_name = tc.constraint_name
		    AND ccu.table_schema = tc.table_schema
		   WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
		 ) k ON k.table_name = c.table_name AND k.column_name = c.column_name
		 WHERE c.table_schema = $1 ORDER BY c.table_name, c.ordinal_position`,
		ident: func(s string) string { return `"` + s + `"` },
		text:  func(e string) string { return "CAST(" + e + " AS TEXT)" },
	},
}

// DSN is what sql.Open takes, and empty for a protocol this build cannot address.
func (d Driver) DSN(host string, port int, c Creds) string {
	cl, ok := clients[d]
	if !ok {
		return ""
	}
	return cl.dsn(host, port, c)
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
		if _, ok := clients[Driver(got)]; ok {
			out = append(out, got)
		}
	}
	sort.Strings(out)
	return out
}

package sandbox

import (
	"fmt"
	"strings"
)

// Driver is the wire protocol a database image speaks, which decides both the
// sql.Open driver name and the DSN shape.
type Driver string

const (
	MySQL    Driver = "mysql"
	Postgres Driver = "postgres"
)

// Image is one row of the table. Supported is false for an image GritQA can
// name but whose driver is not linked into this build — the same distinction
// lang.Framework draws with Static, and for the same reason: "I know what this
// is and cannot do it yet" beats a confusing failure.
type Image struct {
	Ref       string
	Driver    Driver
	Port      int
	Supported bool
	// Password names the env var the image's entrypoint reads for the superuser
	// password; Database names the one that creates a schema on first boot.
	Password string
	Database string
	User     string
}

var images = []Image{
	{Ref: "mysql:8", Driver: MySQL, Port: 3306, Supported: true,
		Password: "MYSQL_ROOT_PASSWORD", Database: "MYSQL_DATABASE", User: "root"},
	{Ref: "mysql:8.4", Driver: MySQL, Port: 3306, Supported: true,
		Password: "MYSQL_ROOT_PASSWORD", Database: "MYSQL_DATABASE", User: "root"},
	{Ref: "mariadb:11", Driver: MySQL, Port: 3306, Supported: true,
		Password: "MARIADB_ROOT_PASSWORD", Database: "MARIADB_DATABASE", User: "root"},
	{Ref: "postgres:16-alpine", Driver: Postgres, Port: 5432,
		Password: "POSTGRES_PASSWORD", Database: "POSTGRES_DB", User: "postgres"},
	{Ref: "postgres:17-alpine", Driver: Postgres, Port: 5432,
		Password: "POSTGRES_PASSWORD", Database: "POSTGRES_DB", User: "postgres"},
}

// Lookup matches on the family, so mysql:8.0.36 resolves through the mysql:8
// row rather than being rejected for not being in the table.
func Lookup(ref string) (Image, error) {
	ref = strings.TrimSpace(ref)
	for _, i := range images {
		if i.Ref == ref {
			return withRef(i, ref), nil
		}
	}
	for _, i := range images {
		if family(ref) == family(i.Ref) {
			return withRef(i, ref), nil
		}
	}
	return Image{}, fmt.Errorf("run.sandbox.image is %q, which GritQA does not know how to bring up — %s",
		ref, "try mysql:8, mariadb:11 or postgres:16-alpine")
}

func withRef(i Image, ref string) Image {
	i.Ref = ref
	return i
}

func family(ref string) string {
	if i := strings.IndexByte(ref, ':'); i >= 0 {
		return ref[:i]
	}
	return ref
}

// DSN is what sql.Open takes. multiStatements is on because Restore feeds a
// dump back through this connection.
func (i Image) DSN(host string, port int, c Creds) string {
	switch i.Driver {
	case MySQL:
		return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&multiStatements=true&timeout=5s",
			c.User, c.Password, host, port, c.Database)
	case Postgres:
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
			c.User, c.Password, host, port, c.Database)
	}
	return ""
}

// Names returns every image in the table, for an error message that lists what
// is on offer.
func Names() []string {
	out := make([]string, 0, len(images))
	for _, i := range images {
		out = append(out, i.Ref)
	}
	return out
}

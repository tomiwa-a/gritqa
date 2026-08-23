package sandbox

import (
	"fmt"
	"strings"
)

// Image is one row of the table GritQA needed while it created the database
// itself: which variable the entrypoint reads for the superuser password, which
// one makes a schema on first boot, which port it listens on.
//
// A project's own compose file answers every one of those, so the compose path
// reads none of this. It is here only for Up, and it goes when Up does.
type Image struct {
	Ref    string
	Driver Driver
	Port   int
	// Password names the env var the image's entrypoint reads for the superuser
	// password; Database names the one that creates a schema on first boot.
	Password string
	Database string
	User     string
}

var images = []Image{
	{Ref: "mysql:8", Driver: MySQL, Port: 3306,
		Password: "MYSQL_ROOT_PASSWORD", Database: "MYSQL_DATABASE", User: "root"},
	{Ref: "mysql:8.4", Driver: MySQL, Port: 3306,
		Password: "MYSQL_ROOT_PASSWORD", Database: "MYSQL_DATABASE", User: "root"},
	{Ref: "mariadb:11", Driver: MySQL, Port: 3306,
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

// Supported asks the build rather than the table: an image GritQA can name but
// whose driver is not linked in is one it cannot read, and linking a driver is
// most of what it takes to change that.
func (i Image) Supported() bool { return Linked(string(i.Driver)) }

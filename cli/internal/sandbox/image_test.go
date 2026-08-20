package sandbox

import (
	"strings"
	"testing"
)

func TestLookupResolvesByFamily(t *testing.T) {
	cases := []struct {
		ref       string
		wantRef   string
		driver    Driver
		port      int
		supported bool
		wantErr   bool
	}{
		{ref: "mysql:8", wantRef: "mysql:8", driver: MySQL, port: 3306, supported: true},
		{ref: "  mysql:8.4  ", wantRef: "mysql:8.4", driver: MySQL, port: 3306, supported: true},

		// A patch tag nobody put in the table still resolves, through the family.
		{ref: "mysql:8.0.36", wantRef: "mysql:8.0.36", driver: MySQL, port: 3306, supported: true},
		{ref: "mariadb:10.11", wantRef: "mariadb:10.11", driver: MySQL, port: 3306, supported: true},

		// Recognised, and honestly reported as not yet drivable.
		{ref: "postgres:16-alpine", wantRef: "postgres:16-alpine", driver: Postgres, port: 5432},
		{ref: "postgres:15", wantRef: "postgres:15", driver: Postgres, port: 5432},

		{ref: "mongo:7", wantErr: true},
		{ref: "", wantErr: true},
	}

	for _, c := range cases {
		got, err := Lookup(c.ref)
		if c.wantErr {
			if err == nil {
				t.Errorf("Lookup(%q) = %+v, want an error", c.ref, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("Lookup(%q): %v", c.ref, err)
			continue
		}
		// The ref is carried through as asked, not rewritten to the table's row:
		// docker run must pull the tag the user named.
		if got.Ref != c.wantRef {
			t.Errorf("Lookup(%q).Ref = %q, want %q", c.ref, got.Ref, c.wantRef)
		}
		if got.Driver != c.driver || got.Port != c.port || got.Supported != c.supported {
			t.Errorf("Lookup(%q) = driver %s port %d supported %v, want %s %d %v",
				c.ref, got.Driver, got.Port, got.Supported, c.driver, c.port, c.supported)
		}
	}
}

func TestLookupErrorNamesAnAlternative(t *testing.T) {
	_, err := Lookup("mongo:7")
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "mysql:8") {
		t.Errorf("the error should say what does work, got %q", err)
	}
}

func TestDSN(t *testing.T) {
	c := Creds{User: "root", Password: "s3cr3t", Database: "gritqa"}
	cases := []struct {
		ref  string
		want string
	}{
		{"mysql:8", "root:s3cr3t@tcp(127.0.0.1:54321)/gritqa" +
			"?parseTime=true&multiStatements=true&timeout=5s"},
		{"postgres:16-alpine", "postgres://root:s3cr3t@127.0.0.1:54321/gritqa?sslmode=disable"},
	}

	for _, tc := range cases {
		img, err := Lookup(tc.ref)
		if err != nil {
			t.Fatal(err)
		}
		if got := img.DSN("127.0.0.1", 54321, c); got != tc.want {
			t.Errorf("%s DSN = %q, want %q", tc.ref, got, tc.want)
		}
	}
}

// multiStatements is load-bearing: Restore feeds a whole mysqldump back through
// this connection, and without it every dump past the first statement fails.
func TestMySQLDSNAllowsMultipleStatements(t *testing.T) {
	img, err := Lookup("mysql:8")
	if err != nil {
		t.Fatal(err)
	}
	dsn := img.DSN("127.0.0.1", 3306, Creds{User: "root", Password: "p", Database: "d"})
	if !strings.Contains(dsn, "multiStatements=true") {
		t.Errorf("DSN = %q, want multiStatements=true", dsn)
	}
}

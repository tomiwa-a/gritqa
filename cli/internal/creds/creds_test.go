package creds

import (
	"errors"
	"testing"
)

// Two checkouts on one machine are two links. A token carries the project it may
// write to, so one shared across directories would land this project's index in
// the other project's rows -- and the server would accept it, because the token
// really is this developer's.
func TestOneLinkPerProject(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home+"/.config")

	s, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	const server = "http://localhost:3000"
	hotel := Key{Server: server, Root: "/src/hotel/api"}
	loans := Key{Server: server, Root: "/src/loanapp"}

	if err := s.Set(hotel, Entry{Token: "hotel-token"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(loans); !errors.Is(err, ErrNoToken) {
		t.Fatalf("a second project resolved a token: %v", err)
	}
	if err := s.Set(loans, Entry{Token: "loans-token"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(hotel); got.Token != "hotel-token" {
		t.Fatalf("hotel now holds %q", got.Token)
	}

	// Logging out of a deployment means logging out of it, not of one directory.
	if gone := s.Forget(server); gone != 2 {
		t.Fatalf("forgot %d links, want both", gone)
	}
	if _, err := s.Get(hotel); !errors.Is(err, ErrNoToken) {
		t.Fatal("a link survived the logout")
	}
}

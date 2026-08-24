// Package creds stores the CLI's bearer tokens outside the repository, one per
// server and project directory.
package creds

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Entry struct {
	Token     string `json:"token"`
	UserEmail string `json:"user_email,omitempty"`
	UserName  string `json:"user_name,omitempty"`
}

type Store struct {
	path    string
	Entries map[string]Entry `json:"entries"`
}

var ErrNoToken = errors.New("not linked to an account yet")

// Key names one link. A token carries the project it may write to, so two
// directories on one machine are two links: sharing one would push this project's
// index into the other project's rows, and the server would accept it.
type Key struct {
	Server string
	Root   string
}

func (k Key) String() string {
	if k.Root == "" {
		return k.Server
	}
	return k.Server + " " + k.Root
}

func dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "gritqa"), nil
}

func Open() (*Store, error) {
	d, err := dir()
	if err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(d, "credentials"), Entries: map[string]Entry{}}

	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(b, s); err != nil {
		return s, nil // a corrupt file re-links rather than blocking
	}
	if s.Entries == nil {
		s.Entries = map[string]Entry{}
	}
	return s, nil
}

func (s *Store) Get(k Key) (Entry, error) {
	e, ok := s.Entries[k.String()]
	if !ok || e.Token == "" {
		return Entry{}, ErrNoToken
	}
	return e, nil
}

func (s *Store) Set(k Key, e Entry) error {
	s.Entries[k.String()] = e
	return s.save()
}

// Forget drops every link to this server, whichever project it was for: logging
// out of a deployment means logging out of it.
func (s *Store) Forget(server string) int {
	gone := 0
	for k := range s.Entries {
		if k == server || strings.HasPrefix(k, server+" ") {
			delete(s.Entries, k)
			gone++
		}
	}
	return gone
}

func (s *Store) Save() error { return s.save() }

func (s *Store) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Path() string { return s.path }

func LogDir() (string, error) {
	d, err := dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "logs"), nil
}

// Package creds stores the CLI's bearer token outside the repository, keyed by
// server host so a machine can be linked to more than one deployment.
package creds

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

func (s *Store) Get(host string) (Entry, error) {
	e, ok := s.Entries[host]
	if !ok || e.Token == "" {
		return Entry{}, ErrNoToken
	}
	return e, nil
}

func (s *Store) Set(host string, e Entry) error {
	s.Entries[host] = e
	return s.save()
}

func (s *Store) Delete(host string) error {
	delete(s.Entries, host)
	return s.save()
}

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

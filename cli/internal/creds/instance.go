package creds

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// InstanceID is a stable name for this machine, minted once and kept beside the
// token. Per machine rather than per checkout or per project: "which machine ran
// this" is a question about hardware, and two clones of one repository are one
// answer to it.
func InstanceID() (string, error) {
	d, err := dir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(d, "instance")

	if id, err := readID(path); err == nil && id != "" {
		return id, nil
	}
	if err := os.MkdirAll(d, 0o700); err != nil {
		return "", err
	}

	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf[:])

	// Exclusive, so two processes starting together settle on one id rather than
	// each writing its own and the loser reporting under a name nothing else uses.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if got, rerr := readID(path); rerr == nil && got != "" {
			return got, nil
		}
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(id + "\n"); err != nil {
		return "", err
	}
	return id, nil
}

func readID(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

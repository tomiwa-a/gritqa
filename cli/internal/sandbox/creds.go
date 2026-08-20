package sandbox

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
)

// Creds are the sandbox's own credentials. GritQA generates the password, which
// is the whole reason this is defensible: no secret of the user's changes hands,
// and nothing in their .env is ever read.
type Creds struct {
	User     string
	Password string
	Database string
}

func newCreds(img Image, database string) (Creds, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return Creds{}, err
	}
	if database == "" {
		database = defaultDatabase
	}
	return Creds{
		User:     img.User,
		Password: base64.RawURLEncoding.EncodeToString(b),
		Database: database,
	}, nil
}

const defaultDatabase = "gritqa"

// scrub keeps the generated password out of anything that gets reported. Docker
// and the migrate command both echo their own stderr, and a dump command that
// fails is quoted back to the user.
func (c Creds) scrub(s string) string {
	if c.Password == "" {
		return s
	}
	return strings.ReplaceAll(s, c.Password, "•••")
}

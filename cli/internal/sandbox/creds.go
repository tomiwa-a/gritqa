package sandbox

import "strings"

// Creds are the sandbox's own credentials. GritQA generates the password, which
// is the whole reason this is defensible: no secret of the user's changes hands,
// and nothing in their .env is ever read.
type Creds struct {
	User     string
	Password string
	Database string
}

// scrub keeps the generated password out of anything that gets reported. Docker
// and the migrate command both echo their own stderr, and a dump command that
// fails is quoted back to the user.
func (c Creds) scrub(s string) string {
	if c.Password == "" {
		return s
	}
	return strings.ReplaceAll(s, c.Password, "•••")
}

package index

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
)

// read loads a file and hashes it in one pass. Files above maxFileSize are
// generated or vendored in practice, and are reported with an empty body so the
// caller counts them without parsing.
func read(abs string) (body []byte, hash string, size int64, err error) {
	fi, err := os.Stat(abs)
	if err != nil {
		return nil, "", 0, err
	}
	size = fi.Size()

	if size > maxFileSize {
		return nil, "", size, nil
	}

	body, err = os.ReadFile(abs)
	if err != nil {
		return nil, "", size, err
	}

	sum := sha256.Sum256(body)
	return body, hex.EncodeToString(sum[:]), int64(len(body)), nil
}

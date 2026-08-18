package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrRefused is a bad key, or a key without access. Sending a second file with
// it is pointless, which is what callers use this to decide.
var ErrRefused = errors.New("refused the key")

// fault turns a bad status into something the user can act on. The likely
// mistake is an sk-ant- key against api.anthropic.com, which speaks
// /v1/messages and 404s the only call GritQA makes.
func fault(url, endpoint string, code int, body []byte) error {
	detail := apiError(body)

	switch {
	case code == http.StatusNotFound:
		return fmt.Errorf("%s has no chat completions endpoint — GritQA speaks the "+
			"OpenAI chat API, so an Anthropic base URL needs a compatibility proxy in front", url)
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return fmt.Errorf("%s %w in %s%s", endpoint, ErrRefused, KeyEnv, detail)
	case code == http.StatusBadRequest && strings.Contains(string(body), "response_format"):
		return errJSONMode
	}
	return fmt.Errorf("%s answered %d%s", url, code, detail)
}

func apiError(body []byte) string {
	var out struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Error.Message == "" {
		return ""
	}
	return ": " + out.Error.Message
}

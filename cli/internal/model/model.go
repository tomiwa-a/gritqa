// Package model is the OpenAI-compatible transport. Drafting, endpoint
// extraction and repair all reach the same endpoint the same way.
package model

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

// KeyEnv holds the user's model key. It is never written to a config file.
const KeyEnv = "GRITQA_API_KEY"

// ModelEnv names the model, for when there is no config yet.
const ModelEnv = "GRITQA_MODEL"

// The caller supplies the wording: "no key" means something different to
// drafting than it does to reading endpoints.
var (
	ErrNoKey   = errors.New("no model key")
	ErrNoModel = errors.New("no model name")
)

type Client struct {
	Endpoint string
	Model    string
	Auth     Token
	HTTP     *http.Client
}

// Credentials is where the bearer comes from. Command wins over the
// environment: an endpoint that mints hour-long tokens makes an exported one
// the value most likely to have expired.
type Credentials struct {
	Command string
	TTL     time.Duration
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// New reads the model name from the environment when the config names none.
func New(endpoint, name string, creds Credentials) (*Client, error) {
	auth, err := creds.token()
	if err != nil {
		return nil, err
	}
	if name == "" {
		name = strings.TrimSpace(os.Getenv(ModelEnv))
	}
	if name == "" {
		return nil, ErrNoModel
	}
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), Model: name, Auth: auth}, nil
}

func (c Credentials) token() (Token, error) {
	if line := strings.TrimSpace(c.Command); line != "" {
		return &Command{Line: line, TTL: c.TTL}, nil
	}
	if key := strings.TrimSpace(os.Getenv(KeyEnv)); key != "" {
		return Static(key), nil
	}
	return nil, ErrNoKey
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 5 * time.Minute}
}

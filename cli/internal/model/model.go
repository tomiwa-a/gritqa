// Package model is the OpenAI-compatible transport. Drafting, endpoint
// extraction and repair all reach the same endpoint with the same key.
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
	Key      string
	HTTP     *http.Client
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// New reads the key from the environment, and the model name from there too when
// the config names none.
func New(endpoint, name string) (*Client, error) {
	key := strings.TrimSpace(os.Getenv(KeyEnv))
	if key == "" {
		return nil, ErrNoKey
	}
	if name == "" {
		name = strings.TrimSpace(os.Getenv(ModelEnv))
	}
	if name == "" {
		return nil, ErrNoModel
	}
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), Model: name, Key: key}, nil
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 5 * time.Minute}
}

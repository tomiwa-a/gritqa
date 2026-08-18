package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const attempts = 2

// retryDelay backs off once before giving up on a rate limit.
var retryDelay = 2 * time.Second

// errJSONMode means the endpoint rejected response_format, which older
// OpenAI-compatible servers do not implement.
var errJSONMode = errors.New("response_format unsupported")

type chatRequest struct {
	Model          string    `json:"model"`
	Messages       []Message `json:"messages"`
	ResponseFormat *format   `json:"response_format,omitempty"`
}

type format struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
}

// Complete sends one turn and returns the reply. JSON mode is asked for, and
// dropped when the endpoint will not take it.
func (c *Client) Complete(ctx context.Context, msgs []Message) (string, error) {
	body, err := json.Marshal(c.request(msgs, true))
	if err != nil {
		return "", err
	}

	out, err := c.post(ctx, body)
	if !errors.Is(err, errJSONMode) {
		return out, err
	}

	if body, err = json.Marshal(c.request(msgs, false)); err != nil {
		return "", err
	}
	return c.post(ctx, body)
}

func (c *Client) request(msgs []Message, jsonMode bool) chatRequest {
	r := chatRequest{Model: c.Model, Messages: msgs}
	if jsonMode {
		r.ResponseFormat = &format{Type: "json_object"}
	}
	return r
}

// post sends one completion, retrying once on a rate limit or a server error.
func (c *Client) post(ctx context.Context, body []byte) (string, error) {
	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(retryDelay):
			}
		}
		out, again, err := c.send(ctx, body)
		if err == nil {
			return out, nil
		}
		last = err
		if !again {
			return "", err
		}
	}
	return "", last
}

func (c *Client) send(ctx context.Context, body []byte) (content string, again bool, err error) {
	url := c.Endpoint + "/chat/completions"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Key)

	res, err := c.client().Do(req)
	if err != nil {
		return "", false, fmt.Errorf("could not reach %s: %w", url, err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return "", true, err
	}
	if res.StatusCode != http.StatusOK {
		return "", res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500,
			fault(url, c.Endpoint, res.StatusCode, raw)
	}

	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", false, fmt.Errorf("%s did not answer in the OpenAI chat shape", url)
	}
	if len(out.Choices) == 0 || out.Choices[0].Message.Content == "" {
		return "", false, fmt.Errorf("%s returned no message", url)
	}
	return out.Choices[0].Message.Content, false, nil
}

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

// post sends one completion, retrying once on a rate limit, a server error, or
// a bearer that expired between two calls. It waits as long as the endpoint
// asked for when it said.
func (c *Client) post(ctx context.Context, body []byte) (string, error) {
	var last error
	wait := retryDelay
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 && wait > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(wait):
			}
		}

		out, again, asked, err := c.send(ctx, body)
		if err == nil {
			return out, nil
		}
		last = err

		switch {
		case again:
			if asked > 0 {
				wait = asked
			}
		// A minted token expires mid-session. Dropping it and asking once more
		// is the difference between a resident process that outlives its bearer
		// and one that dies after an hour.
		case errors.Is(err, ErrRefused) && c.Auth.Stale():
			wait = 0
		default:
			return "", err
		}
	}
	return "", last
}

func (c *Client) send(ctx context.Context, body []byte) (content string, again bool, asked time.Duration, err error) {
	url := c.Endpoint + "/chat/completions"

	bearer, err := c.Auth.Token(ctx)
	if err != nil {
		return "", false, 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", false, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+bearer)

	res, err := c.client().Do(req)
	if err != nil {
		return "", false, 0, fmt.Errorf("could not reach %s: %w", url, err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return "", true, 0, err
	}
	if res.StatusCode != http.StatusOK {
		again := res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500
		return "", again, retryAfter(res.Header, raw),
			fault(url, c.Endpoint, c.Auth.String(), res.StatusCode, raw)
	}

	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", false, 0, fmt.Errorf("%s did not answer in the OpenAI chat shape", url)
	}
	if len(out.Choices) == 0 || out.Choices[0].Message.Content == "" {
		return "", false, 0, fmt.Errorf("%s returned no message", url)
	}
	return out.Choices[0].Message.Content, false, 0, nil
}

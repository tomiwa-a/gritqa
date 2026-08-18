package draft

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gritqa/cli/internal/plan"
)

// KeyEnv holds the user's model key. It is never written to a config file.
const KeyEnv = "GRITQA_API_KEY"

// ModelEnv names the model, for when there is no config yet.
const ModelEnv = "GRITQA_MODEL"

const attempts = 2

// retryDelay backs off once before giving up on a rate limit.
var retryDelay = 2 * time.Second

// errJSONMode means the endpoint rejected response_format, which older
// OpenAI-compatible servers do not implement.
var errJSONMode = errors.New("response_format unsupported")

// Local calls an OpenAI-compatible endpoint with the user's own key.
type Local struct {
	Endpoint string
	Model    string
	Key      string
	HTTP     *http.Client
}

// NewLocal reads the key from the environment. With no key there is no
// drafting, exactly as the settings page promises.
func NewLocal(endpoint, model string) (*Local, error) {
	key := strings.TrimSpace(os.Getenv(KeyEnv))
	if key == "" {
		return nil, fmt.Errorf("drafting needs a model key — export %s. "+
			"Without one you can still write plans by hand and GritQA will run them", KeyEnv)
	}
	if model == "" {
		model = strings.TrimSpace(os.Getenv(ModelEnv))
	}
	if model == "" {
		return nil, fmt.Errorf("drafting needs a model name — add run.model.name to your "+
			"config, or export %s", ModelEnv)
	}
	return &Local{Endpoint: strings.TrimRight(endpoint, "/"), Model: model, Key: key}, nil
}

// Draft asks for a plan and validates the answer. One bad reply gets one
// correction, then it is reported rather than guessed at.
func (l *Local) Draft(ctx context.Context, req Request) (*plan.Plan, error) {
	msgs := messages(req)

	for attempt := 1; attempt <= attempts; attempt++ {
		raw, err := l.complete(ctx, msgs)
		if err != nil {
			return nil, err
		}
		p, perr := Parse(raw)
		if perr == nil {
			return finish(p, req), nil
		}
		if attempt == attempts {
			return nil, fmt.Errorf("the model wrote a plan I could not use: %w", perr)
		}
		msgs = append(msgs,
			message{Role: "assistant", Content: raw},
			message{Role: "user", Content: correction(perr)})
	}
	return nil, errors.New("no plan was drafted")
}

type chatRequest struct {
	Model          string    `json:"model"`
	Messages       []message `json:"messages"`
	ResponseFormat *format   `json:"response_format,omitempty"`
}

type format struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message message `json:"message"`
	} `json:"choices"`
}

func (l *Local) complete(ctx context.Context, msgs []message) (string, error) {
	body, err := json.Marshal(l.request(msgs, true))
	if err != nil {
		return "", err
	}

	out, err := l.post(ctx, body)
	if !errors.Is(err, errJSONMode) {
		return out, err
	}

	if body, err = json.Marshal(l.request(msgs, false)); err != nil {
		return "", err
	}
	return l.post(ctx, body)
}

func (l *Local) request(msgs []message, jsonMode bool) chatRequest {
	r := chatRequest{Model: l.Model, Messages: msgs}
	if jsonMode {
		r.ResponseFormat = &format{Type: "json_object"}
	}
	return r
}

// post sends one completion, retrying once on a rate limit or a server error.
func (l *Local) post(ctx context.Context, body []byte) (string, error) {
	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(retryDelay):
			}
		}
		out, again, err := l.send(ctx, body)
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

func (l *Local) send(ctx context.Context, body []byte) (content string, again bool, err error) {
	url := l.Endpoint + "/chat/completions"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+l.Key)

	res, err := l.client().Do(req)
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
			fault(url, l.Endpoint, res.StatusCode, raw)
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

func (l *Local) client() *http.Client {
	if l.HTTP != nil {
		return l.HTTP
	}
	return &http.Client{Timeout: 2 * time.Minute}
}

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
		return fmt.Errorf("%s refused the key in %s%s", endpoint, KeyEnv, detail)
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

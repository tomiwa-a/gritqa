// Package cloud is the CLI's side of the dashboard: the /api/cli routes, and
// nothing else. It carries no judgement — every method here is a message the
// hands send to the brain, or an answer coming back.
package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/creds"
)

// ErrUnlinked is no token for this server. The same error creds reports, so a
// caller can tell "never linked" from "linked and refused" without unwrapping.
var ErrUnlinked = creds.ErrNoToken

// ErrLostJob is a 404 from a job route. The server no longer holds this job as
// ours: reaped, released, or already reported. Either way, stop.
var ErrLostJob = errors.New("the server has this job as someone else's now")

type Client struct {
	Server string
	Token  string
	HTTP   *http.Client
}

// New reads the token stored for this server. The key is the server string the
// rest of the CLI uses, so --server and GRITQA_SERVER pick the same entry the
// login wrote and --logout would remove.
func New(server, root string) (*Client, error) {
	store, err := creds.Open()
	if err != nil {
		return nil, err
	}
	entry, err := store.Get(creds.Key{Server: server, Root: root})
	if err != nil {
		return nil, err
	}
	return &Client{Server: server, Token: entry.Token}, nil
}

// Unauthorized is a 401. Named because no amount of retrying fixes it: a CLI
// token is good for ninety days and the only thing that revokes one mid-poll is a
// human, or a project that no longer exists.
type Unauthorized struct{ Server string }

func (e *Unauthorized) Error() string {
	return "the dashboard would not accept this machine's token — link again with gritqa --logout, then gritqa"
}

// Refused is any other answer with a reason. The routes reply with a short code
// rather than prose, and passing it through unchanged is more use than a sentence
// this package would have to invent.
type Refused struct {
	Path   string
	Status int
	Code   string
}

func (e *Refused) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s answered %d: %s", e.Path, e.Status, e.Code)
	}
	return fmt.Sprintf("%s answered %d", e.Path, e.Status)
}

// bodyCap bounds what one answer may be. A claim carries a whole plan, so this is
// generous; it exists so a wrong URL answering with a video cannot exhaust memory.
const bodyCap = 8 << 20

type reply struct {
	Status int
	Body   []byte
}

func (r reply) ok() bool { return r.Status >= 200 && r.Status < 300 }

func (r reply) into(out any) error {
	if out == nil || len(r.Body) == 0 {
		return nil
	}
	if err := json.Unmarshal(r.Body, out); err != nil {
		return fmt.Errorf("the dashboard answered %d with something that is not JSON", r.Status)
	}
	return nil
}

// code is the {"error": "..."} the routes reply with.
func (r reply) code() string {
	var body struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &body)
	return body.Error
}

// call sends JSON and reads the answer whole. The status comes back rather than
// being turned into an error here: the device flow branches on 202 and 403, and a
// job route treats 404 as news rather than as failure.
func (c *Client) call(ctx context.Context, method, path string, in any) (reply, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return reply{}, err
		}
		body = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.Server, "/")+path, body)
	if err != nil {
		return reply{}, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	res, err := c.client().Do(req)
	if err != nil {
		return reply{}, fmt.Errorf("could not reach %s: %w", c.Server, err)
	}
	defer res.Body.Close()

	b, err := io.ReadAll(io.LimitReader(res.Body, bodyCap))
	if err != nil {
		return reply{Status: res.StatusCode}, err
	}
	return reply{Status: res.StatusCode, Body: b}, nil
}

// fail turns a refusal into something a person can act on.
func (c *Client) fail(path string, r reply) error {
	if r.Status == http.StatusUnauthorized {
		return &Unauthorized{Server: c.Server}
	}
	return &Refused{Path: path, Status: r.Status, Code: r.code()}
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 60 * time.Second}
}

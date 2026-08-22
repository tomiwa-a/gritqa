package cloud

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// Dial-out. The CLI opens the connection because a hosted dashboard cannot reach a
// laptop, and the shape is deliberately dull:
//
//	GET  /api/cli/mcp/dial?instanceId=…           -> application/x-ndjson, one
//	                                                JSON-RPC message per line; a
//	                                                line starting ':' is keepalive
//	POST /api/cli/mcp/reply {instanceId, frame}   -> 200
//
// One duplex request would save the POST's round trip, but a request body that
// never ends is not something a serverless runtime reliably reads.
const (
	dialPath  = "/api/cli/mcp/dial"
	replyPath = "/api/cli/mcp/reply"
)

// lineCap bounds one frame coming down, so a wrong URL streaming a video cannot
// exhaust memory.
const lineCap = 4 << 20

// Uplink is the dashboard's end of the tool surface, shaped as an io.ReadWriteCloser
// so the MCP server serves it like any other transport. Close is idempotent: the
// transport holds it as both its reader and its writer.
type Uplink struct {
	c        *Client
	instance string
	ctx      context.Context

	body io.ReadCloser
	pr   *io.PipeReader
	pw   *io.PipeWriter

	mu   sync.Mutex
	part []byte

	once     sync.Once
	closeErr error
}

// Dial opens the downstream. A nil error means the dashboard accepted the
// connection, not that it will send anything.
func (c *Client) Dial(ctx context.Context, instanceID string) (*Uplink, error) {
	target := strings.TrimRight(c.Server, "/") + dialPath +
		"?instanceId=" + url.QueryEscape(instanceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/x-ndjson")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	res, err := c.stream().Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		res.Body.Close()
		return nil, c.fail(dialPath, reply{Status: res.StatusCode, Body: b})
	}

	pr, pw := io.Pipe()
	up := &Uplink{c: c, instance: instanceID, ctx: ctx, body: res.Body, pr: pr, pw: pw}
	go up.down()
	return up, nil
}

// down feeds the stream into the pipe the MCP server reads, dropping keepalives:
// the SDK's decoder wants one JSON value per line and nothing else.
func (u *Uplink) down() {
	s := bufio.NewScanner(u.body)
	s.Buffer(make([]byte, 0, 64<<10), lineCap)
	for s.Scan() {
		line := s.Bytes()
		if len(line) == 0 || line[0] == ':' {
			continue
		}
		frame := make([]byte, 0, len(line)+1)
		frame = append(append(frame, line...), '\n')
		if _, err := u.pw.Write(frame); err != nil {
			break
		}
	}
	err := s.Err()
	if err == nil {
		err = io.EOF
	}
	u.pw.CloseWithError(err)
}

func (u *Uplink) Read(p []byte) (int, error) { return u.pr.Read(p) }

// Write posts whole frames. The SDK writes one newline-terminated message per call,
// but a partial write is buffered rather than assumed away.
func (u *Uplink) Write(p []byte) (int, error) {
	u.mu.Lock()
	u.part = append(u.part, p...)
	var frames [][]byte
	for {
		at := bytes.IndexByte(u.part, '\n')
		if at < 0 {
			break
		}
		if at > 0 {
			frames = append(frames, append([]byte(nil), u.part[:at]...))
		}
		u.part = u.part[at+1:]
	}
	u.mu.Unlock()

	for _, frame := range frames {
		if err := u.post(frame); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

func (u *Uplink) post(frame []byte) error {
	r, err := u.c.call(u.ctx, http.MethodPost, replyPath, struct {
		InstanceID string          `json:"instanceId"`
		Frame      json.RawMessage `json:"frame"`
	}{u.instance, frame})
	if err != nil {
		return err
	}
	if !r.ok() {
		return u.c.fail(replyPath, r)
	}
	return nil
}

func (u *Uplink) Close() error {
	u.once.Do(func() {
		u.closeErr = u.body.Close()
		u.pr.Close()
	})
	return u.closeErr
}

// stream has no timeout, because the downstream is meant to stay open for as long
// as the process runs. c.client()'s sixty seconds would sever it.
func (c *Client) stream() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{}
}

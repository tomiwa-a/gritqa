package mcp

import (
	"context"
	"io"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Dial serves one client over a connection this process opened, which is the whole
// of decision 24: MCP over HTTP assumes the client reaches the server, and a hosted
// dashboard cannot reach a laptop. Same tools, same framing, the transport inverted.
//
// Read scope, always. Approved work arrives as a job and goes through the engine;
// an execute tool reachable over a relay would be the review gate routed around.
//
// The connection is the authorization, as it is for stdio: whoever opened it had
// already authenticated to the dashboard, so no bearer travels over it.
//
// up is held as both the reader and the writer, so its Close is called twice and
// has to tolerate that.
func (s *Server) Dial(ctx context.Context, up io.ReadWriteCloser) error {
	err := s.build(Read).Run(ctx, &sdk.IOTransport{Reader: up, Writer: up})
	if ended(err) {
		return nil
	}
	return err
}

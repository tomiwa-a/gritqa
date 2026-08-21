package mcp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Stdio is the address that means "talk over stdin and stdout" — what an MCP host
// spawning the binary needs.
const Stdio = "stdio"

// Serve runs until the context is cancelled.
func (s *Server) Serve(ctx context.Context, addr string) error {
	if addr == "" || addr == Stdio {
		return s.serveStdio(ctx)
	}
	return s.serveHTTP(ctx, addr)
}

// serveStdio serves the one client that spawned this process. There is no bearer
// to read, so spawning is the authorization and the scope was fixed at New.
//
// Stdout is the protocol from here on. Everything human goes to Log.
func (s *Server) serveStdio(ctx context.Context) error {
	s.log(fmt.Sprintf("serving %d tools over stdio at %s scope", s.count(s.stdio), s.stdio))
	err := s.build(s.stdio).Run(ctx, &sdk.StdioTransport{})
	if ended(err) {
		return nil
	}
	return err
}

// serverClosing is what the SDK reports when the pipe went away, including a host
// that closed it mid-request. It arrives with the read error appended by %v, so
// the code on the public wire type is what there is to match.
const serverClosing = -32004

// ended is true for the ways a stdio session stops that are not failures: a host
// closing the pipe, and a Ctrl-C. Anything else is a bug and exits 1.
func ended(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrClosedPipe) || errors.Is(err, os.ErrClosed) ||
		errors.Is(err, sdk.ErrConnectionClosed) {
		return true
	}
	var wire *jsonrpc.Error
	return errors.As(err, &wire) && wire.Code == serverClosing
}

// serveHTTP serves every scope on one listener, choosing the server from the
// bearer. Loopback only: a tool surface over the developer's project is not
// something to put on a network interface.
func (s *Server) serveHTTP(ctx context.Context, addr string) error {
	addr, err := loopback(addr)
	if err != nil {
		return err
	}

	built := map[Scope]*sdk.Server{}
	for scope := range s.keys.tokens {
		built[scope] = s.build(scope)
	}

	mcp := sdk.NewStreamableHTTPHandler(func(r *http.Request) *sdk.Server {
		scope, _ := s.keys.scope(r)
		return built[scope]
	}, &sdk.StreamableHTTPOptions{CrossOriginProtection: &http.CrossOriginProtection{}})

	srv := &http.Server{
		Addr:              addr,
		Handler:           s.authorize(mcp),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.addr = ln.Addr().String()
	s.log("serving MCP on http://" + s.addr)
	for scope, token := range s.keys.tokens {
		s.log(fmt.Sprintf("  %-7s %d tools   Authorization: Bearer %s", scope, s.count(scope), token))
	}

	done := make(chan error, 1)
	go func() { done <- srv.Serve(ln) }()

	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		stop, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		return srv.Shutdown(stop)
	}
}

// authorize answers an unauthenticated request itself, so a client gets a 401 and
// the WWW-Authenticate header the spec asks for rather than the SDK's 400.
func (s *Server) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scope, ok := s.keys.scope(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="gritqa"`)
			http.Error(w, "a scoped bearer token is required", http.StatusUnauthorized)
			return
		}
		// getServer picks the scope's tools when a session opens; every request
		// after that routes by session id, so the id has to belong to this scope
		// or an execute session would carry a read bearer into an execute tool.
		if id := r.Header.Get("Mcp-Session-Id"); id != "" && !sessionMatches(id, scope) {
			http.Error(w, "that session was not opened at this scope", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) count(scope Scope) int {
	n := 0
	for _, t := range surface {
		if scope.allows(t.scope) {
			n++
		}
	}
	return n
}

// loopback fills in a missing host and refuses one that is not this machine.
func loopback(addr string) (string, error) {
	if !strings.Contains(addr, ":") {
		addr = "127.0.0.1:" + addr
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("%s is not an address: %w", addr, err)
	}
	if host == "" {
		return net.JoinHostPort("127.0.0.1", port), nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return addr, nil
	}
	if strings.EqualFold(host, "localhost") {
		return addr, nil
	}
	return "", fmt.Errorf("%s is not a loopback address — the tool surface reads this project's "+
		"source, so it is served to this machine only", host)
}

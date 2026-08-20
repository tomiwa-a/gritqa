package sandbox

import (
	"net"
	"strings"
	"sync"
)

// This file is what runtime: host still needs. Everything in it exists because a
// process on this machine has no docker logs and no published port to ask about.

func freePort() (int, error) {
	l, err := net.Listen("tcp", loopback+":0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// ring keeps the last few lines of a process's output without growing without
// bound over a long run.
type ring struct {
	mu    sync.Mutex
	lines []string
	part  string
	max   int
}

func (r *ring) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.part += string(p)
	for {
		i := strings.IndexByte(r.part, '\n')
		if i < 0 {
			break
		}
		if line := strings.TrimSpace(r.part[:i]); line != "" {
			r.lines = append(r.lines, line)
			if len(r.lines) > r.max {
				r.lines = r.lines[len(r.lines)-r.max:]
			}
		}
		r.part = r.part[i+1:]
	}
	return len(p), nil
}

func (r *ring) last() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lines) == 0 {
		return "it printed nothing"
	}
	return r.lines[len(r.lines)-1]
}

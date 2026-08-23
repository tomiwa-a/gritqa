// Package sandbox brings up a copy of the developer's project on their own
// compose file, runs whatever they say brings its schema up, and reports what a
// test run moved inside it.
//
// It decides nothing about the project. Which service answers HTTP, which holds
// the data, and what migrates it are answers an Environment carries, because
// they are questions about someone else's declaration rather than anything this
// can derive from it.
package sandbox

import (
	"context"
	"fmt"
	"io"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	// Linked for its side effect: registering a client is what puts a protocol in
	// Drivers(), which is why that asks the build instead of declaring a list.
	_ "github.com/lib/pq"
)

// The driver logs every failed connection to stderr, and awaitDB deliberately
// fails dozens of them while an image runs its first-boot setup. Every error that
// matters is reported with its own context, so the raw log is only noise.
func init() { mysql.SetLogger(log.New(io.Discard, "", 0)) }

const (
	defaultReady = 90 * time.Second
	loopback     = "127.0.0.1"
)

// firstPort reads docker port's output, which is "127.0.0.1:54321" and may carry
// several lines when both address families are bound.
func firstPort(out string, container int) (int, error) {
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if i := strings.LastIndexByte(line, ':'); i >= 0 {
			if n, err := strconv.Atoi(strings.TrimSpace(line[i+1:])); err == nil && n > 0 {
				return n, nil
			}
		}
	}
	return 0, fmt.Errorf("docker published no port for %d", container)
}

// cancelled turns a subprocess killed by a Ctrl-C into the reason it was killed.
// Without it an interrupted compose call reads as a stack that would not come up,
// and main.go loses the 130 it maps context.Canceled to.
func cancelled(ctx context.Context, err error) error {
	if ce := ctx.Err(); ce != nil {
		return ce
	}
	return err
}

// dockerReason picks the line that says what went wrong. Docker puts the reason
// first and "Run 'docker run --help'" last, so lastLine would report the one line
// that carries no information. A denied mount is singled out because it is a
// Docker Desktop setting rather than anything GritQA can fix, and unexplained it
// reads as a bug here.
func dockerReason(text string) string {
	var lines []string
	for _, l := range strings.Split(text, "\n") {
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(t, "Run 'docker") || strings.HasPrefix(t, "See http") {
			continue
		}
		lines = append(lines, t)
	}
	if len(lines) == 0 {
		return "no output"
	}
	if path := deniedPath(text); path != "" {
		return fmt.Sprintf("Docker is not allowed to mount %s, so it cannot see your project — "+
			"add it under Docker Desktop → Settings → Resources → File Sharing, or set "+
			"run.sandbox.mount to a directory it can reach", path)
	}
	return lines[0]
}

// deniedPath reads the path out of Docker Desktop's file-sharing refusal.
func deniedPath(text string) string {
	const marker = "is not shared from the host"
	i := strings.Index(text, marker)
	if i < 0 {
		return ""
	}
	before := strings.TrimSpace(text[:i])
	if j := strings.LastIndex(before, "The path "); j >= 0 {
		return strings.TrimSpace(before[j+len("The path "):])
	}
	return strings.TrimSpace(before[strings.LastIndex(before, "\n")+1:])
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(lines[i]); t != "" {
			return t
		}
	}
	return "no output"
}

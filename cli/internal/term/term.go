// Package term renders CLI output. The line kinds, glyphs and layout mirror
// the TermLine union in web/src/components/ui/terminal.tsx.
package term

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tomiwa-a/gritqa/cli/internal/index/progress"
	"golang.org/x/term"
)

type Kind int

const (
	Blank Kind = iota
	Cmd        // $ prompt
	OK         // ✓
	Fail       // ✕
	Info       // dimmed, unmarked
	Out        // unmarked, full contrast
	Tree       // ├── / └──
	Progress   // index stage heartbeat, NDJSON only
)

type Status int

const (
	None Status = iota
	Pass
	Failed
	Skip
)

type Line struct {
	Kind   Kind
	Text   string
	Meta   string // pushed to the right edge
	Last   bool   // tree only: └── instead of ├──
	Status Status
	// Set for Progress lines only: the stage heartbeat this line carries.
	Event progress.Event
}

// Palette from the --color-term-* tokens in web/src/app/globals.css. Tree
// prefixes use term-dim rather than the web build's rule-dark, which would be
// invisible against a terminal background we do not control.
var (
	promptRed  = rgb{239, 35, 60}
	inkInverse = rgb{247, 249, 250}
	termPass   = rgb{52, 211, 153}
	termFail   = rgb{251, 113, 133}
	termDim    = rgb{123, 134, 160}
)

type rgb struct{ r, g, b uint8 }

func (c rgb) wrap(s string, on bool) string {
	if !on || s == "" {
		return s
	}
	return fmt.Sprintf("\x1b[38;2;%d;%d;%dm%s\x1b[0m", c.r, c.g, c.b, s)
}

const maxWidth = 96

// Writer renders lines to a stream: the full design on a colour TTY, glyphs
// without colour on a pipe, flat prefixed lines in Plain mode, and one JSON
// object per line in JSON mode.
type Writer struct {
	out   io.Writer
	color bool
	width int
	plain bool
	json  bool
}

func New(out io.Writer) *Writer {
	w := &Writer{out: out, width: 80}

	fd, isFile := fdOf(out)
	tty := isFile && term.IsTerminal(fd)

	if tty {
		if cols, _, err := term.GetSize(fd); err == nil && cols > 20 {
			w.width = cols
		}
	}

	_, noColor := os.LookupEnv("NO_COLOR")
	w.color = tty && !noColor && os.Getenv("TERM") != "dumb"

	if w.width > maxWidth {
		w.width = maxWidth
	}
	return w
}

// Plain switches to flat prefixed lines, for CI logs and --verbose.
func (w *Writer) Plain() *Writer {
	w.plain = true
	w.color = false
	return w
}

// UseJSON switches to one JSON object per line, for --json. Progress heartbeats
// and transcript lines share the shape: {"kind": ..., ...}. A blank line still
// writes nothing, so the stream stays parseable.
func (w *Writer) UseJSON() *Writer {
	w.json = true
	w.color = false
	return w
}

func fdOf(out io.Writer) (int, bool) {
	f, ok := out.(*os.File)
	if !ok {
		return 0, false
	}
	return int(f.Fd()), true
}

func (w *Writer) Write(l Line) {
	if w.json {
		if out := jsonOf(l); out != "" {
			fmt.Fprintln(w.out, out)
		}
		return
	}
	// Progress heartbeats are NDJSON-only: in human modes the stage summaries
	// carry the same news without a line per file.
	if l.Kind == Progress {
		return
	}
	if w.plain {
		fmt.Fprintln(w.out, plainOf(l))
		return
	}
	fmt.Fprintln(w.out, w.render(l))
}

func (w *Writer) Writef(format string, args ...any) {
	w.Write(Line{Kind: Out, Text: fmt.Sprintf(format, args...)})
}

func (w *Writer) All(lines ...Line) {
	for _, l := range lines {
		w.Write(l)
	}
}

func (w *Writer) render(l Line) string {
	if l.Kind == Blank || l.Kind == Progress {
		return ""
	}

	var gutter, text, right string

	switch l.Kind {
	case Cmd:
		gutter = promptRed.wrap("$", w.color)
		text = inkInverse.wrap(l.Text, w.color)

	case OK:
		gutter = termPass.wrap("✓", w.color)
		text = inkInverse.wrap(l.Text, w.color)

	case Fail:
		gutter = termFail.wrap("✕", w.color)
		text = inkInverse.wrap(l.Text, w.color)

	case Info:
		gutter = " "
		text = termDim.wrap(l.Text, w.color)

	case Out:
		gutter = " "
		text = inkInverse.wrap(l.Text, w.color)

	case Tree:
		prefix := "├──"
		if l.Last {
			prefix = "└──"
		}
		gutter = termDim.wrap(prefix, w.color)
		text = inkInverse.wrap(l.Text, w.color)
		if mark, tone, ok := glyphOf(l.Status); ok {
			right = tone.wrap(mark, w.color)
		}
	}

	if l.Meta != "" {
		if right != "" {
			right += " " + termDim.wrap(l.Meta, w.color)
		} else {
			right = termDim.wrap(l.Meta, w.color)
		}
	}

	left := gutter + " " + text
	if right == "" {
		return left
	}

	pad := w.width - visible(left) - visible(right)
	if pad < 1 {
		pad = 1
	}
	return left + strings.Repeat(" ", pad) + right
}

func glyphOf(s Status) (string, rgb, bool) {
	switch s {
	case Pass:
		return "✓", termPass, true
	case Failed:
		return "✕", termFail, true
	case Skip:
		return "–", termDim, true
	}
	return "", rgb{}, false
}

func plainOf(l Line) string {
	if l.Kind == Blank || l.Kind == Progress {
		return ""
	}

	var prefix string
	switch l.Kind {
	case Cmd:
		prefix = "$ "
	case OK:
		prefix = "ok: "
	case Fail:
		prefix = "fail: "
	case Info, Out:
		prefix = "  "
	case Tree:
		switch l.Status {
		case Pass:
			prefix = "  - pass: "
		case Failed:
			prefix = "  - fail: "
		case Skip:
			prefix = "  - skip: "
		default:
			prefix = "  - "
		}
	}

	line := strings.TrimRight(prefix+l.Text, " ")
	if l.Meta != "" {
		line += " (" + l.Meta + ")"
	}
	return line
}

// jsonOf renders one line as one JSON object. Transcript lines carry kind,
// text and meta; progress heartbeats carry the stage counters. A line the
// stream has no shape for writes nothing rather than something unparseable.
func jsonOf(l Line) string {
	if l.Kind == Blank {
		return ""
	}
	if l.Kind == Progress {
		raw, err := json.Marshal(struct {
			Kind string `json:"kind"`
			progress.Event
		}{Kind: "progress", Event: l.Event})
		if err != nil {
			return ""
		}
		return string(raw)
	}
	raw, err := json.Marshal(struct {
		Kind string `json:"kind"`
		Text string `json:"text"`
		Meta string `json:"meta,omitempty"`
	}{Kind: kindName(l.Kind), Text: l.Text, Meta: l.Meta})
	if err != nil {
		return ""
	}
	return string(raw)
}

func kindName(k Kind) string {
	switch k {
	case Cmd:
		return "cmd"
	case OK:
		return "ok"
	case Fail:
		return "fail"
	case Info:
		return "info"
	case Out:
		return "out"
	case Tree:
		return "tree"
	default:
		return "info"
	}
}

// visible counts printable columns, discarding SGR escapes.
func visible(s string) int {
	n, esc := 0, false
	for _, r := range s {
		switch {
		case esc && r == 'm':
			esc = false
		case esc:
		case r == 0x1b:
			esc = true
		default:
			n++
		}
	}
	if n == 0 {
		return utf8.RuneCountInString(s)
	}
	return n
}

// Dur formats the Meta column: ms under a second, then seconds to 1dp.
func Dur(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Round(time.Millisecond)/time.Millisecond)
	}
	return fmt.Sprintf("%.1fs", d.Seconds())
}

func Count(n int, singular, plural string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, singular)
	}
	return fmt.Sprintf("%d %s", n, plural)
}

package term

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func newTest(buf *bytes.Buffer, width int) *Writer {
	return &Writer{out: buf, color: false, width: width}
}

func TestRenderGutters(t *testing.T) {
	cases := []struct {
		name string
		line Line
		want string
	}{
		{"cmd", Line{Kind: Cmd, Text: "gritqa"}, "$ gritqa"},
		{"ok", Line{Kind: OK, Text: "mapped your project"}, "✓ mapped your project"},
		{"fail", Line{Kind: Fail, Text: "expected 201, got 500"}, "✕ expected 201, got 500"},
		{"info", Line{Kind: Info, Text: "waiting for your review"}, "  waiting for your review"},
		{"out", Line{Kind: Out, Text: "what it found"}, "  what it found"},
		{"tree", Line{Kind: Tree, Text: "34 endpoints"}, "├── 34 endpoints"},
		{"tree last", Line{Kind: Tree, Text: "12 models", Last: true}, "└── 12 models"},
		{"blank", Line{Kind: Blank}, ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var buf bytes.Buffer
			newTest(&buf, 80).Write(c.line)
			if got := strings.TrimRight(buf.String(), "\n"); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestMetaIsRightAligned(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf, 40).Write(Line{Kind: OK, Text: "read your project", Meta: "1.1s"})

	got := strings.TrimRight(buf.String(), "\n")
	if n := visible(got); n != 40 {
		t.Fatalf("line is %d columns, want 40: %q", n, got)
	}
	if !strings.HasSuffix(got, "1.1s") {
		t.Errorf("meta not flush right: %q", got)
	}
	if !strings.HasPrefix(got, "✓ read your project ") {
		t.Errorf("text not flush left: %q", got)
	}
}

// terminal.tsx puts the status glyph ahead of the timing via ml-auto.
func TestTreeStatusPrecedesMeta(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf, 40).Write(Line{Kind: Tree, Text: "sign in", Status: Pass, Meta: "84ms"})

	got := strings.TrimRight(buf.String(), "\n")
	if !strings.HasSuffix(got, "✓ 84ms") {
		t.Errorf("want the line to end in %q, got %q", "✓ 84ms", got)
	}
}

func TestOverlongLineFallsBackToSingleSpace(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf, 20).Write(Line{
		Kind: OK,
		Text: "a step whose description runs well past the edge",
		Meta: "1.1s",
	})

	got := strings.TrimRight(buf.String(), "\n")
	if strings.Contains(got, "  ") {
		t.Errorf("expected a single space before meta, got %q", got)
	}
	if !strings.HasSuffix(got, " 1.1s") {
		t.Errorf("meta was dropped: %q", got)
	}
}

func TestColorEscapesAreNotCountedAsWidth(t *testing.T) {
	var buf bytes.Buffer
	w := newTest(&buf, 40)
	w.color = true
	w.Write(Line{Kind: OK, Text: "read your project", Meta: "1.1s"})

	got := strings.TrimRight(buf.String(), "\n")
	if !strings.Contains(got, "\x1b[38;2;") {
		t.Fatal("expected colour escapes to be emitted")
	}
	if n := visible(got); n != 40 {
		t.Errorf("visible width is %d, want 40 — escapes leaked into the padding", n)
	}
}

func TestPlainModeDropsLayout(t *testing.T) {
	var buf bytes.Buffer
	w := New(&buf).Plain()
	w.All(
		Line{Kind: Cmd, Text: "gritqa"},
		Line{Kind: OK, Text: "read your project", Meta: "1.1s"},
		Line{Kind: Tree, Text: "refund it", Status: Pass, Meta: "96ms"},
		Line{Kind: Fail, Text: "check out", Meta: "212ms"},
	)

	want := []string{
		"$ gritqa",
		"ok: read your project (1.1s)",
		"  - pass: refund it (96ms)",
		"fail: check out (212ms)",
	}
	got := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")

	if len(got) != len(want) {
		t.Fatalf("got %d lines, want %d: %q", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d: got %q, want %q", i, got[i], want[i])
		}
	}
	if strings.ContainsAny(buf.String(), "├└✓✕") {
		t.Error("plain mode should not emit box drawing or glyphs")
	}
}

func TestDur(t *testing.T) {
	cases := []struct {
		in   time.Duration
		want string
	}{
		{71 * time.Millisecond, "71ms"},
		{340 * time.Millisecond, "340ms"},
		{999 * time.Millisecond, "999ms"},
		{time.Second, "1.0s"},
		{1100 * time.Millisecond, "1.1s"},
		{6200 * time.Millisecond, "6.2s"},
	}
	for _, c := range cases {
		if got := Dur(c.in); got != c.want {
			t.Errorf("Dur(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCount(t *testing.T) {
	if got := Count(1, "plan", "plans"); got != "1 plan" {
		t.Errorf("got %q", got)
	}
	if got := Count(2, "plan", "plans"); got != "2 plans" {
		t.Errorf("got %q", got)
	}
}

// The hero.tsx transcript is a promise about this renderer's output.
func TestHeroTranscript(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf, 64).All(
		Line{Kind: Cmd, Text: "gritqa"},
		Line{Kind: Info, Text: "watching ~/api on branch main"},
		Line{Kind: OK, Text: "read your project — 214 files", Meta: "1.1s"},
		Line{Kind: Out, Text: "changed since your last run"},
		Line{Kind: Tree, Text: "checkout handler   applies tax"},
		Line{Kind: Tree, Text: "refund handler     new endpoint"},
		Line{Kind: Tree, Text: "order model        two new fields", Last: true},
		Line{Kind: OK, Text: "drafted 2 test plans for what changed", Meta: "6.2s"},
		Line{Kind: Info, Text: "waiting for your review · app.gritqa.dev/review"},
		Line{Kind: Out, Text: "nothing runs until you approve it."},
	)

	got := buf.String()
	for _, want := range []string{
		"$ gritqa",
		"  watching ~/api on branch main",
		"└── order model        two new fields",
		"  nothing runs until you approve it.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("transcript missing %q\n---\n%s", want, got)
		}
	}

	for _, line := range strings.Split(strings.TrimRight(got, "\n"), "\n") {
		if visible(line) > 64 {
			t.Errorf("line exceeds width: %q", line)
		}
	}
}

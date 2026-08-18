// Package lexical scans the languages GritQA reads without a real parser.
//
// It is deliberately not a parser. Route extraction needs three things from a
// file — string literals, call shapes and variable bindings — and a token stream
// carries all three. What it has to get exactly right is where strings begin and
// end, because one mis-scanned quote corrupts every token after it.
package lexical

import "strings"

type Kind uint8

const (
	Ident Kind = iota
	String
	Number
	Punct
)

// Token is one lexeme. Text is the identifier, the single punctuation character,
// or a string's contents. Interp marks a string whose value depends on an
// expression, which is what makes it unusable as a path.
type Token struct {
	Kind   Kind
	Text   string
	Line   int
	Interp bool
}

type Mode uint8

const (
	JS Mode = iota
	Python
)

func Scan(mode Mode, src []byte) []Token {
	s := &scanner{mode: mode, src: src, line: 1}
	s.run()
	return s.out
}

type scanner struct {
	mode Mode
	src  []byte
	i    int
	line int
	out  []Token
}

func (s *scanner) run() {
	for s.i < len(s.src) {
		c := s.src[s.i]
		switch {
		case c == '\n':
			s.line++
			s.i++
		case c == ' ' || c == '\t' || c == '\r' || c == '\f':
			s.i++
		case s.skipComment():
		case c == '"' || c == '\'' || c == '`':
			s.scanString("")
		case isIdentStart(c):
			s.scanIdent()
		case isDigit(c):
			s.scanNumber()
		case c == '/' && s.mode == JS && s.regexAhead():
			s.skipRegex()
		default:
			s.emit(Punct, string(c))
			s.i++
		}
	}
}

func (s *scanner) emit(k Kind, text string) {
	s.out = append(s.out, Token{Kind: k, Text: text, Line: s.line})
}

func (s *scanner) skipComment() bool {
	if s.mode == Python {
		if s.src[s.i] != '#' {
			return false
		}
		s.skipLine()
		return true
	}
	if s.src[s.i] != '/' || s.i+1 >= len(s.src) {
		return false
	}
	switch s.src[s.i+1] {
	case '/':
		s.skipLine()
	case '*':
		for s.i += 2; s.i < len(s.src); s.i++ {
			if s.src[s.i] == '\n' {
				s.line++
				continue
			}
			if s.ahead("*/") {
				s.i += 2
				break
			}
		}
	default:
		return false
	}
	return true
}

func (s *scanner) skipLine() {
	for s.i < len(s.src) && s.src[s.i] != '\n' {
		s.i++
	}
}

func (s *scanner) scanIdent() {
	start := s.i
	for s.i < len(s.src) && isIdentPart(s.src[s.i]) {
		s.i++
	}
	word := string(s.src[start:s.i])

	// f"…", rb'…': the prefix belongs to the string, not to an identifier.
	if s.mode == Python && s.i < len(s.src) && isStringPrefix(word) &&
		(s.src[s.i] == '"' || s.src[s.i] == '\'') {
		s.scanString(word)
		return
	}
	s.out = append(s.out, Token{Kind: Ident, Text: word, Line: s.line})
}

func (s *scanner) scanNumber() {
	start := s.i
	for s.i < len(s.src) && (isIdentPart(s.src[s.i]) || s.src[s.i] == '.') {
		s.i++
	}
	s.emit(Number, string(s.src[start:s.i]))
}

func (s *scanner) scanString(prefix string) {
	line, quote := s.line, s.src[s.i]
	raw := strings.ContainsAny(prefix, "rR")
	formatted := strings.ContainsAny(prefix, "fF")

	triple := string([]byte{quote, quote, quote})
	width := 1
	if s.mode == Python && s.ahead(triple) {
		width = 3
	}
	s.i += width

	var b strings.Builder
	for s.i < len(s.src) {
		c := s.src[s.i]
		switch {
		case c == '\\' && !raw && s.i+1 < len(s.src):
			s.i++
			if s.src[s.i] == '\n' {
				s.line++
			}
			b.WriteByte(unescape(s.src[s.i]))
			s.i++
			continue
		case c == quote && (width == 1 || s.ahead(triple)):
			s.i += width
			s.out = append(s.out, Token{
				Kind: String, Text: b.String(), Line: line,
				Interp: quote == '`' && strings.Contains(b.String(), "${") ||
					formatted && strings.Contains(b.String(), "{"),
			})
			return
		// Only a template literal or a triple quote may span lines. Stopping at
		// the newline keeps one stray quote from swallowing the rest of the file.
		case c == '\n' && width == 1 && quote != '`':
			s.emit(String, b.String())
			return
		case c == '\n':
			s.line++
		}
		b.WriteByte(c)
		s.i++
	}
	s.emit(String, b.String())
}

// regexAhead reports whether a / opens a regex literal rather than dividing.
// It matters because a quote inside a regex would otherwise open a string.
func (s *scanner) regexAhead() bool {
	if len(s.out) == 0 {
		return true
	}
	last := s.out[len(s.out)-1]
	switch last.Kind {
	case Ident:
		return regexKeywords[last.Text]
	case Punct:
		return last.Text != ")" && last.Text != "]"
	}
	return false
}

// regexKeywords are the words a regex can legally follow.
var regexKeywords = map[string]bool{
	"return": true, "typeof": true, "instanceof": true, "in": true, "of": true,
	"new": true, "delete": true, "void": true, "case": true, "do": true,
	"else": true, "yield": true, "await": true, "throw": true, "match": true,
	"replace": true, "split": true, "test": true,
}

// skipRegex drops the literal: a path GritQA cannot read is better absent than
// wrong, and the registration is still reported as unresolved.
func (s *scanner) skipRegex() {
	s.i++
	class := false
	for s.i < len(s.src) && s.src[s.i] != '\n' {
		switch c := s.src[s.i]; {
		case c == '\\':
			s.i++
		case c == '[':
			class = true
		case c == ']':
			class = false
		case c == '/' && !class:
			s.i++
			for s.i < len(s.src) && isIdentPart(s.src[s.i]) {
				s.i++
			}
			return
		}
		s.i++
	}
}

func (s *scanner) ahead(want string) bool {
	return strings.HasPrefix(string(s.src[s.i:]), want)
}

func unescape(c byte) byte {
	switch c {
	case 'n':
		return '\n'
	case 't':
		return '\t'
	case 'r':
		return '\r'
	}
	return c
}

func isStringPrefix(w string) bool {
	if w == "" || len(w) > 2 {
		return false
	}
	return strings.Trim(w, "fFrRbBuU") == ""
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || c >= 0x80 ||
		c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

func isIdentPart(c byte) bool { return isIdentStart(c) || isDigit(c) }

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

package lexical

import "strings"

// Call is a call expression: a dotted callee and its top-level arguments.
type Call struct {
	Name  string
	Line  int
	Args  [][]Token
	Start int // index of the first callee token
	End   int // index just past the closing paren
}

// Recv splits the callee into the value it was called on and the method name.
// Both Express's app.get and FastAPI's router.get are read this way.
func (c Call) Recv() (recv, method string) {
	i := strings.LastIndexByte(c.Name, '.')
	if i < 0 {
		return "", c.Name
	}
	return c.Name[:i], c.Name[i+1:]
}

// Arg returns the i-th argument, or nil.
func (c Call) Arg(i int) []Token {
	if i >= len(c.Args) {
		return nil
	}
	return c.Args[i]
}

// Calls returns every call in the stream, in source order. A nested call appears
// as its own entry as well as inside its parent's arguments, which is what lets
// one matcher read r = express.Router() and another app.use(express.json()).
func Calls(toks []Token) []Call {
	var out []Call
	for i, t := range toks {
		if t.Kind != Punct || t.Text != "(" {
			continue
		}
		start, name := calleeAt(toks, i)
		if name == "" {
			continue
		}
		args, end := argsAt(toks, i)
		out = append(out, Call{
			Name: name, Line: toks[start].Line, Args: args, Start: start, End: end,
		})
	}
	return out
}

// calleeAt reads the dotted name immediately before an open paren. A chain that
// runs through anything else — arr[0].get( — yields only the trailing name, so
// the receiver stays unknown rather than being guessed at.
func calleeAt(toks []Token, paren int) (start int, name string) {
	last := paren - 1
	if last < 0 || toks[last].Kind != Ident {
		return 0, ""
	}

	start = last
	for start >= 2 && isDot(toks[start-1]) && toks[start-2].Kind == Ident {
		start -= 2
	}

	var b strings.Builder
	for i := start; i <= last; i++ {
		b.WriteString(toks[i].Text)
	}
	return start, b.String()
}

// argsAt splits an argument list at top level, keeping every nested token.
func argsAt(toks []Token, paren int) ([][]Token, int) {
	var args [][]Token
	var arg []Token
	depth := 0

	for i := paren; i < len(toks); i++ {
		t := toks[i]
		if t.Kind == Punct {
			switch t.Text {
			case "(", "[", "{":
				if depth++; depth == 1 {
					continue
				}
			case ")", "]", "}":
				if depth--; depth == 0 {
					if len(arg) > 0 {
						args = append(args, arg)
					}
					return args, i + 1
				}
			case ",":
				if depth == 1 {
					args, arg = append(args, arg), nil
					continue
				}
			}
		}
		arg = append(arg, t)
	}
	return args, len(toks)
}

// Assign is a binding: the name, and the tokens its value is built from.
type Assign struct {
	Name  string
	Line  int
	Value []Token
}

// Assigns returns the assignments in the stream. Depth counts parentheses and
// brackets but not braces, which is what separates a binding from a keyword
// argument while still reaching an Express router built inside a function.
func Assigns(toks []Token) []Assign {
	var out []Assign
	depth := 0

	for i, t := range toks {
		if t.Kind == Punct {
			switch t.Text {
			case "(", "[":
				depth++
			case ")", "]":
				depth--
			}
		}
		if depth != 0 || !isPunct(t, "=") || i == 0 || toks[i-1].Kind != Ident {
			continue
		}
		// == and => are two tokens, not an assignment.
		if i+1 < len(toks) && (isPunct(toks[i+1], "=") || isPunct(toks[i+1], ">")) {
			continue
		}
		out = append(out, Assign{
			Name:  toks[i-1].Text,
			Line:  toks[i-1].Line,
			Value: statement(toks, i+1),
		})
	}
	return out
}

// Ctor reads the call a value is built from, which is how a router announces
// itself: express.Router(), APIRouter(prefix="/v1"), Flask(__name__).
func Ctor(value []Token) (Call, bool) {
	calls := Calls(value)
	if len(calls) == 0 || calls[0].Start != 0 {
		return Call{}, false
	}
	return calls[0], true
}

// statement takes the tokens of one value. It ends at a semicolon, at a comma
// or bracket it does not own, or at the first token on a later line outside
// brackets — which is what stands in for a terminator in two languages that
// mostly do without one.
func statement(toks []Token, from int) []Token {
	if from >= len(toks) {
		return nil
	}

	depth, line := 0, toks[from].Line
	for i := from; i < len(toks); i++ {
		t := toks[i]
		if depth == 0 && i > from && t.Line > line {
			return toks[from:i]
		}
		if t.Kind == Punct {
			switch t.Text {
			case "(", "[", "{":
				depth++
			case ")", "]", "}":
				if depth == 0 {
					return toks[from:i]
				}
				depth--
			case ";", ",":
				if depth == 0 {
					return toks[from:i]
				}
			}
		}
		line = t.Line
	}
	return toks[from:]
}

// Str returns an argument's value when it is one literal string that does not
// depend on an expression. Anything else is not a path worth trusting.
func Str(arg []Token) (string, bool) {
	if len(arg) != 1 || arg[0].Kind != String || arg[0].Interp {
		return "", false
	}
	return arg[0].Text, true
}

// Name renders a dotted name, or "" when the tokens are not one.
func Name(toks []Token) string {
	if len(toks) == 0 || toks[0].Kind != Ident || toks[len(toks)-1].Kind != Ident {
		return ""
	}

	var b strings.Builder
	for i, t := range toks {
		switch {
		case i%2 == 0 && t.Kind == Ident:
			b.WriteString(t.Text)
		case i%2 == 1 && isDot(t):
			b.WriteString(".")
		default:
			return ""
		}
	}
	return b.String()
}

// Kwarg finds a named argument. Python's prefix="/v1" and the JS object form
// { prefix: "/v1" } both reduce to a name, a separator and a value.
func Kwarg(args [][]Token, name string) ([]Token, bool) {
	for _, arg := range args {
		for i := 0; i+2 < len(arg); i++ {
			if arg[i].Kind != Ident || arg[i].Text != name {
				continue
			}
			if !isPunct(arg[i+1], "=") && !isPunct(arg[i+1], ":") {
				continue
			}
			if isPunct(arg[i+2], "=") {
				continue
			}
			return statement(arg[i+2:], 0), true
		}
	}
	return nil, false
}

// StrKwarg is the common case: a named argument holding a literal string.
func StrKwarg(args [][]Token, name string) (string, bool) {
	v, ok := Kwarg(args, name)
	if !ok {
		return "", false
	}
	return Str(v)
}

func isDot(t Token) bool { return isPunct(t, ".") }

func isPunct(t Token, text string) bool { return t.Kind == Punct && t.Text == text }

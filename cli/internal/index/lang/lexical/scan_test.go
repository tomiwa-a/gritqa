package lexical

import (
	"strings"
	"testing"
)

// A mis-scanned quote corrupts every token after it, so the string rules are
// what this package lives or dies by.
func TestStringsEndWhereTheyShould(t *testing.T) {
	cases := []struct {
		name string
		mode Mode
		src  string
		want []string
	}{
		{"quotes and escapes", JS,
			`a("it\"s", 'x')`, []string{`it"s`, "x"}},

		{"template literal without interpolation", JS,
			"a(`/orders`)", []string{"/orders"}},

		{"apostrophe in a comment does not open a string", JS,
			"// it's fine\na(\"/ok\")", []string{"/ok"}},

		{"quote inside a block comment", JS,
			"/* \" */ a(\"/ok\")", []string{"/ok"}},

		{"quote inside a regex literal", JS,
			`const re = /["']/; a("/ok")`, []string{"/ok"}},

		{"division is not a regex", JS,
			`x = (a) / 2; a("/ok")`, []string{"/ok"}},

		{"python triple quote spanning lines", Python,
			"'''\ndoc \" text\n'''\na(\"/ok\")", []string{"\ndoc \" text\n", "/ok"}},

		{"python hash comment", Python,
			"# it's fine\na(\"/ok\")", []string{"/ok"}},

		{"raw string keeps its backslash", Python,
			`a(r"\d+")`, []string{`\d+`}},

		{"unterminated quote stops at the newline", JS,
			"a(\"oops\nb(\"/ok\")", []string{"oops", "/ok"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got []string
			for _, tok := range Scan(c.mode, []byte(c.src)) {
				if tok.Kind == String {
					got = append(got, tok.Text)
				}
			}
			if strings.Join(got, "|") != strings.Join(c.want, "|") {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

// A string whose value depends on an expression cannot be used as a path.
func TestInterpolationIsFlagged(t *testing.T) {
	cases := []struct {
		mode Mode
		src  string
		want bool
	}{
		{JS, "a(`/orders/${id}`)", true},
		{JS, "a(`/orders`)", false},
		{Python, `a(f"/orders/{id}")`, true},
		{Python, `a("/orders/{id}")`, false}, // FastAPI's own path syntax
	}

	for _, c := range cases {
		toks := Scan(c.mode, []byte(c.src))
		for _, tok := range toks {
			if tok.Kind == String && tok.Interp != c.want {
				t.Errorf("%s: interp = %v, want %v", c.src, tok.Interp, c.want)
			}
		}
	}
}

func TestLineNumbersSurviveEveryConstruct(t *testing.T) {
	src := "// one\n/* two\nthree */\nconst s = `four\nfive`\nmark(1)\n"
	for _, c := range Calls(Scan(JS, []byte(src))) {
		if c.Name == "mark" && c.Line != 6 {
			t.Errorf("mark is on line %d, want 6", c.Line)
		}
	}
}

func TestCallsReadReceiverAndArguments(t *testing.T) {
	toks := Scan(JS, []byte(`
		const router = express.Router()
		router.get("/orders/:id", auth, (req, res) => res.json({ok: true}))
		app.use("/v1", router)
	`))

	var names []string
	for _, c := range Calls(toks) {
		names = append(names, c.Name)
	}
	if got := strings.Join(names, " "); got != "express.Router router.get res.json app.use" {
		t.Errorf("got %q", got)
	}

	var get Call
	for _, c := range Calls(toks) {
		if c.Name == "router.get" {
			get = c
		}
	}
	if recv, method := get.Recv(); recv != "router" || method != "get" {
		t.Errorf("recv = %q, method = %q", recv, method)
	}
	if len(get.Args) != 3 {
		t.Fatalf("got %d args, want 3", len(get.Args))
	}
	if p, ok := Str(get.Arg(0)); !ok || p != "/orders/:id" {
		t.Errorf("path = %q (%v)", p, ok)
	}
	if n := Name(get.Arg(1)); n != "auth" {
		t.Errorf("middleware = %q", n)
	}
}

// A chain through anything but a dot leaves the receiver unknown, which is what
// keeps an unrelated cache.get from reading as a route.
func TestReceiverIsOnlyReadThroughDots(t *testing.T) {
	for _, src := range []string{`handlers[0].get("/x", h)`, `make().get("/x", h)`} {
		for _, c := range Calls(Scan(JS, []byte(src))) {
			if recv, _ := c.Recv(); c.Name == "get" && recv != "" {
				t.Errorf("%s: recv = %q, want unknown", src, recv)
			}
		}
	}
}

func TestAssignsFindBindingsAtAnyDepth(t *testing.T) {
	got := map[string]string{}
	for _, a := range Assigns(Scan(Python, []byte(`
router = APIRouter(prefix="/v1")

def create_app():
    app = Flask(__name__)
    if x == y:
        pass
    return app
`))) {
		c, _ := Ctor(a.Value)
		got[a.Name] = c.Name
	}

	if got["router"] != "APIRouter" || got["app"] != "Flask" {
		t.Errorf("got %v", got)
	}
	if _, ok := got["x"]; ok {
		t.Error("== is not an assignment")
	}
	if _, ok := got["prefix"]; ok {
		t.Error("a keyword argument is not a binding")
	}
}

// A router built inside a function still has to be found: Express routes are
// often mounted from a setup function, and Flask apps from a factory.
func TestAssignsReachInsideBraces(t *testing.T) {
	var names []string
	for _, a := range Assigns(Scan(JS, []byte(`
function build() {
  const router = express.Router()
  return router
}
`))) {
		names = append(names, a.Name)
	}
	if strings.Join(names, ",") != "router" {
		t.Errorf("got %v", names)
	}
}

func TestAssignValueStopsAtTheStatementEnd(t *testing.T) {
	toks := Scan(Python, []byte("urlpatterns = [\n    path(\"orders/\", views.list),\n]\n\nx = 1\n"))

	var value []Token
	for _, a := range Assigns(toks) {
		if a.Name == "urlpatterns" {
			value = a.Value
		}
	}
	if n := len(Calls(value)); n != 1 {
		t.Fatalf("got %d calls in the list, want 1", n)
	}
	if !isPunct(value[len(value)-1], "]") {
		t.Errorf("value should end at the closing bracket, got %+v", value[len(value)-1])
	}
}

func TestKwargReadsBothSeparators(t *testing.T) {
	python := Calls(Scan(Python, []byte(`APIRouter(prefix="/v1", tags=["x"])`)))
	if p, ok := StrKwarg(python[0].Args, "prefix"); !ok || p != "/v1" {
		t.Errorf("python prefix = %q (%v)", p, ok)
	}

	js := Calls(Scan(JS, []byte(`app.register(routes, { prefix: "/v1" })`)))
	if p, ok := StrKwarg(js[0].Args, "prefix"); !ok || p != "/v1" {
		t.Errorf("js prefix = %q (%v)", p, ok)
	}
}

// A type annotation sits between the name and the value in both languages, and
// reading the type as the name loses the router as well as the constant.
func TestAssignsBindTheNameNotTheType(t *testing.T) {
	got := map[string]string{}
	for _, a := range Assigns(Scan(Python, []byte(`
API_V1_STR: str = "/api/v1"
TAGS: list[str] = []
timeout: Optional[int] = 30
`))) {
		s, _ := Str(a.Value)
		got[a.Name] = s
	}
	if got["API_V1_STR"] != "/api/v1" {
		t.Errorf("python annotated binding = %v", got)
	}
	if _, ok := got["str"]; ok {
		t.Error("str is the type, not the name")
	}

	var names []string
	for _, a := range Assigns(Scan(JS, []byte(`
const router: Router = express.Router()
const prefix: string = '/v1'
switch (k) { case FALLBACK: prefix = '/v2' }
`))) {
		names = append(names, a.Name)
	}
	if strings.Join(names, ",") != "router,prefix,prefix" {
		t.Errorf("got %v", names)
	}
}

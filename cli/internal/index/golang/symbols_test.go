package golang

import "testing"

func TestSymbols(t *testing.T) {
	src := `package p

import "fmt"

const Version = "1.0"

var (
	ErrGone = fmt.Errorf("gone")
	_       = 1
)

type Store struct{}

type key int

func New() *Store { return nil }

func (s *Store) Get(id string) error { return nil }

func (s Store) put() {}

func (c *Cache[T]) Warm() {}
`

	f, err := Parse("p.go", []byte(src))
	if err != nil {
		t.Fatal(err)
	}
	syms := f.Symbols()

	counts := Counts(syms)
	want := map[SymbolKind]int{Func: 1, Method: 3, Type: 2, Const: 1, Var: 1}
	for k, n := range want {
		if counts[k] != n {
			t.Errorf("%s count = %d, want %d", k, counts[k], n)
		}
	}

	byName := map[string]Symbol{}
	for _, s := range syms {
		byName[s.Name] = s
	}

	if got := byName["Get"]; got.Receiver != "Store" || got.Kind != Method || !got.Exported {
		t.Errorf("Get = %+v", got)
	}
	if got := byName["put"]; got.Receiver != "Store" || got.Exported {
		t.Errorf("put = %+v", got)
	}
	if got := byName["Warm"]; got.Receiver != "Cache" {
		t.Errorf("generic receiver = %q, want Cache", got.Receiver)
	}
	if got := byName["Version"]; got.Kind != Const || got.Line != 5 {
		t.Errorf("Version = %+v", got)
	}
	if _, ok := byName["_"]; ok {
		t.Error("blank identifier should be skipped")
	}
}

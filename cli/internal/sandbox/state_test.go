package sandbox

import (
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/run"
)

func mark(rows ...Row) *Watermark { return &Watermark{Units: rows} }

func TestDiff(t *testing.T) {
	cases := []struct {
		name          string
		before, after *Watermark
		want          []run.Moved
	}{
		{
			name:   "an insert reports its count and how far the key got",
			before: mark(Row{Name: "guests", Rows: 41, High: "41"}),
			after:  mark(Row{Name: "guests", Rows: 44, High: "44"}),
			want:   []run.Moved{{Unit: "guests", Rows: 3, From: "41", To: "44"}},
		},
		{
			name:   "a delete reports a negative count",
			before: mark(Row{Name: "guests", Rows: 44, High: "44"}),
			after:  mark(Row{Name: "guests", Rows: 42, High: "44"}),
			want:   []run.Moved{{Unit: "guests", Rows: -2, From: "44", To: "44"}},
		},
		{
			// An update leaves the count alone. Without the key it would read as
			// nothing having happened.
			name:   "an update moves only the key",
			before: mark(Row{Name: "bookings", Rows: 7, High: "2026-08-19T10:00:00Z"}),
			after:  mark(Row{Name: "bookings", Rows: 7, High: "2026-08-20T11:30:00Z"}),
			want: []run.Moved{{Unit: "bookings", Rows: 0,
				From: "2026-08-19T10:00:00Z", To: "2026-08-20T11:30:00Z"}},
		},
		{
			name:   "an untouched table is left out",
			before: mark(Row{Name: "guests", Rows: 41, High: "41"}, Row{Name: "rooms", Rows: 12, High: "12"}),
			after:  mark(Row{Name: "guests", Rows: 42, High: "42"}, Row{Name: "rooms", Rows: 12, High: "12"}),
			want:   []run.Moved{{Unit: "guests", Rows: 1, From: "41", To: "42"}},
		},
		{
			// A UUID key has no MAX worth reading, so the count is all there is and
			// the reading carries no from/to.
			name:   "a count-only unit reports no key",
			before: mark(Row{Name: "sessions", Rows: 3, CountOnly: true}),
			after:  mark(Row{Name: "sessions", Rows: 5, CountOnly: true}),
			want:   []run.Moved{{Unit: "sessions", Rows: 2}},
		},
		{
			// A migration ran mid-run: absent before means compared against zero
			// rather than dropped.
			name:   "a table that did not exist before still reports",
			before: mark(),
			after:  mark(Row{Name: "invoices", Rows: 4, High: "4"}),
			want:   []run.Moved{{Unit: "invoices", Rows: 4, From: "", To: "4"}},
		},
		{
			name:   "biggest mover first, then by name",
			before: mark(Row{Name: "b", Rows: 0}, Row{Name: "a", Rows: 0}, Row{Name: "c", Rows: 0}),
			after:  mark(Row{Name: "b", Rows: 1}, Row{Name: "a", Rows: 1}, Row{Name: "c", Rows: 9}),
			want: []run.Moved{
				{Unit: "c", Rows: 9},
				{Unit: "a", Rows: 1},
				{Unit: "b", Rows: 1},
			},
		},
		{
			name:   "nothing moved",
			before: mark(Row{Name: "guests", Rows: 41, High: "41"}),
			after:  mark(Row{Name: "guests", Rows: 41, High: "41"}),
			want:   nil,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := c.after.Diff(c.before)
			if len(got) != len(c.want) {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("[%d] got %+v, want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}

// A run with no earlier reading annotates nothing rather than reporting every
// table as newly created.
func TestDiffAgainstNothing(t *testing.T) {
	w := mark(Row{Name: "guests", Rows: 41})
	if got := w.Diff(nil); got != nil {
		t.Errorf("Diff(nil) = %+v, want nil", got)
	}
	if got := w.Diff((*Watermark)(nil)); got != nil {
		t.Errorf("Diff(typed nil) = %+v, want nil", got)
	}
}

func TestCountQuery(t *testing.T) {
	w := &Watcher{c: clients[MySQL], units: []unit{{table: "guests", key: "id"}, {table: "sessions"}}}
	got := w.countQuery()
	want := "SELECT 'guests' AS u, COUNT(*) AS n, CAST(MAX(`id`) AS CHAR) AS hi FROM `guests`" +
		" UNION ALL " +
		"SELECT 'sessions' AS u, COUNT(*) AS n, NULL AS hi FROM `sessions`"
	if got != want {
		t.Errorf("countQuery =\n%s\nwant\n%s", got, want)
	}
}

func TestRank(t *testing.T) {
	cases := []struct {
		col, dtype    string
		auto, primary bool
		want          int
	}{
		{"id", "bigint", true, true, 3},
		{"id", "int", false, true, 2},
		{"created_at", "datetime", false, false, 1},
		{"deleted_at", "timestamp", false, false, 1},
		{"id", "char", false, true, 0},       // a UUID key is count-only
		{"name", "varchar", false, false, 0}, // and so is anything unordered
		{"price", "decimal", false, false, 0},
	}
	for _, c := range cases {
		if got := rank(c.col, c.dtype, c.auto, c.primary); got != c.want {
			t.Errorf("rank(%q, %q, auto %v, pk %v) = %d, want %d",
				c.col, c.dtype, c.auto, c.primary, got, c.want)
		}
	}
}

func TestSafeIdent(t *testing.T) {
	for _, ok := range []string{"guests", "Booking_2026", "a"} {
		if !safeIdent(ok) {
			t.Errorf("safeIdent(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "gue`sts", "drop\x00", "a\nb"} {
		if safeIdent(bad) {
			t.Errorf("safeIdent(%q) = true", bad)
		}
	}
}

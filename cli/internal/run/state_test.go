package run

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

// fakeState hands out a reading per call, so a walk can be checked against a
// known sequence without a database.
type fakeState struct {
	n     int
	marks []int64
	err   error
}

type fakeMark int64

func (s *fakeState) Mark(context.Context) (Mark, error) {
	if s.err != nil {
		return nil, s.err
	}
	i := s.n
	s.n++
	if i >= len(s.marks) {
		i = len(s.marks) - 1
	}
	return fakeMark(s.marks[i]), nil
}

func (m fakeMark) Diff(before Mark) []Moved {
	prev, ok := before.(fakeMark)
	if !ok {
		return nil
	}
	if int64(m) == int64(prev) {
		return nil
	}
	return []Moved{{Unit: "rows", Rows: int64(m) - int64(prev)}}
}

func TestWrites(t *testing.T) {
	cases := map[string]bool{
		"POST": true, "PUT": true, "PATCH": true, "DELETE": true, "post": true,
		"GET": false, "HEAD": false, "OPTIONS": false, "get": false,
		// Extraction reports no method for 62 endpoints today, and
		// http.NewRequestWithContext defaults an empty one to GET.
		"": false,
	}
	for method, want := range cases {
		if got := writes(plan.Step{Request: plan.Request{Method: method}}); got != want {
			t.Errorf("writes(%q) = %v, want %v", method, got, want)
		}
	}
}

func TestRunReadsTheStateAroundEachWrite(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	p := parse(t, `
		{"id":"list","name":"list","request":{"method":"GET","url":"/g"},
		 "assertions":[{"type":"status","operator":"equals","expected":200}]},
		{"id":"create","name":"create","request":{"method":"POST","url":"/g"},
		 "assertions":[{"type":"status","operator":"equals","expected":200}]},
		{"id":"del","name":"del","request":{"method":"DELETE","url":"/g/1"},
		 "assertions":[{"type":"status","operator":"equals","expected":200}]}`)

	st := &fakeState{marks: []int64{41, 44, 42, 42}}
	res, err := (&Engine{BaseURL: srv.URL, State: st}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}

	// Four readings: before the walk, after each of the two writes, and after the
	// run. The GET takes none.
	if st.n != 4 {
		t.Errorf("took %d readings, want 4", st.n)
	}
	if got := res.Steps[0].Moved; got != nil {
		t.Errorf("the GET reported %+v, want nothing", got)
	}
	if got := res.Steps[1].Moved; len(got) != 1 || got[0].Rows != 3 {
		t.Errorf("create moved %+v, want +3", got)
	}
	if got := res.Steps[2].Moved; len(got) != 1 || got[0].Rows != -2 {
		t.Errorf("delete moved %+v, want -2", got)
	}
	// The run's own ledger is against the reading taken before the first step.
	if len(res.Moved) != 1 || res.Moved[0].Rows != 1 {
		t.Errorf("the run ledger is %+v, want +1", res.Moved)
	}
	if res.StateErr != "" {
		t.Errorf("StateErr = %q, want none", res.StateErr)
	}
}

// A watermark that cannot be read is annotation that went missing, not a failed
// run: the HTTP result stands on its own.
func TestRunSurvivesAnUnreadableState(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	p := parse(t, `{"id":"create","name":"create","request":{"method":"POST","url":"/g"},
		"assertions":[{"type":"status","operator":"equals","expected":200}]}`)

	st := &fakeState{err: errors.New("the sandbox went away")}
	res, err := (&Engine{BaseURL: srv.URL, State: st}).Run(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != RunPassed {
		t.Errorf("status = %s, want passed", res.Status)
	}
	if res.StateErr == "" {
		t.Error("a reading that failed should be reported")
	}
	if res.Moved != nil {
		t.Errorf("Moved = %+v, want nothing", res.Moved)
	}
}

// The nil case is the one that has to keep working: every other engine test
// builds an Engine with no State at all.
func TestRunWithoutAStateTakesNoReadings(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	p := parse(t, `{"id":"create","name":"create","request":{"method":"POST","url":"/g"},
		"assertions":[{"type":"status","operator":"equals","expected":200}]}`)

	res := exec(t, srv.URL, p)
	if res.Status != RunPassed {
		t.Errorf("status = %s, want passed", res.Status)
	}
	if res.Moved != nil || res.StateErr != "" {
		t.Errorf("Moved = %+v, StateErr = %q, want neither", res.Moved, res.StateErr)
	}
}

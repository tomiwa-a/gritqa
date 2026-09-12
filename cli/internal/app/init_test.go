package app

import (
	"reflect"
	"testing"

	"github.com/tomiwa-a/gritqa/cli/internal/config"
)

// Added services arrive blank and therefore blocking; removed ones are dropped
// with their names reported; survivors keep their verdicts untouched, which is
// the whole point of refreshing rather than re-scaffolding.
func TestRefreshServicesDiffsAgainstLive(t *testing.T) {
	stored := map[string]config.Service{
		"api":    {Role: "tested", Port: 80},
		"db":     {Role: "support"},
		"tunnel": {Role: "ignore", Why: "live token"},
		"gone":   {Role: "support"},
	}
	live := map[string]bool{"api": true, "db": true, "tunnel": true, "worker": true}

	added, dropped := refreshServices(stored, live)

	if !reflect.DeepEqual(added, []string{"worker"}) {
		t.Errorf("added = %v, want [worker]", added)
	}
	if !reflect.DeepEqual(dropped, []string{"gone"}) {
		t.Errorf("dropped = %v, want [gone]", dropped)
	}
	if _, ok := stored["worker"]; !ok {
		t.Error("a new service has no entry to judge")
	}
	if stored["api"].Role != "tested" || stored["tunnel"].Why != "live token" {
		t.Errorf("survivors moved: %+v", stored)
	}
	if _, ok := stored["gone"]; ok {
		t.Error("a removed service kept its verdict")
	}
}

func TestBlankServicesArriveUnjudged(t *testing.T) {
	got := blankServices([]string{"db", "api"})
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
	for name, verdict := range got {
		if verdict.Role != "" || verdict.Port != 0 || verdict.Why != "" || verdict.Run != nil {
			t.Errorf("%s arrives judged: %+v", name, verdict)
		}
	}
}

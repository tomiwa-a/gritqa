package sandbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Overlay is the compose document GritQA boots: the developer's own, as compose
// itself resolved it, with the edits that make a copy safe to run beside the
// original. Nothing here is a judgement -- which service is the app and which
// paths it writes to were decided by whoever wrote the Environment, and this only
// applies the consequences.
//
// Every edit closes a way a copy could reach the original:
//   - the project name, so containers, volumes and networks are GritQA's own
//   - the explicit names compose stamps into its own output, dropped, because a
//     copy under a new project name would otherwise still mount hotel_db-data
//   - every published port, dropped, so a copy cannot fight the original for
//     3306; the app's and the database's come back on a loopback port the kernel
//     picks
//   - every bind mount read-only, with a volume over each writable path, so an
//     upload lands in the copy and not in the developer's tree
//   - restart: no, so teardown is the end of it
type Overlay struct {
	Project  string
	Document []byte
	// Dropped are the host ports the original publishes and the copy does not,
	// "db 3307" shaped.
	Dropped []string
	// Detached are the external volumes and networks the copy will not join. They
	// belong to something the developer is already running, and a copy that wrote
	// into one would not be a copy.
	Detached []string
	// Shared are the volumes created for the writable paths, one per path.
	Shared []string
}

// Overlay builds the document. project is the compose project name, which is what
// namespaces everything the copy creates.
func (c *Compose) Overlay(e Environment, project string) (*Overlay, error) {
	if len(c.raw) == 0 {
		return nil, errors.New("this compose file was described rather than read, so there is " +
			"no document to boot a copy of")
	}
	var doc map[string]any
	if err := json.Unmarshal(c.raw, &doc); err != nil {
		return nil, fmt.Errorf("compose config returned something unreadable: %w", err)
	}
	services, _ := doc["services"].(map[string]any)
	if len(services) == 0 {
		return nil, fmt.Errorf("%s declares no services", strings.Join(c.Files, ", "))
	}
	doc["name"] = project

	// The writable volumes go on the app and on whatever brings the schema up:
	// those are the containers the environment says share the project's tree, so a
	// seeder writing a file and the app reading it back see the same one.
	shares := map[string]bool{e.App: true}
	for _, s := range e.Schema {
		shares[s.Service] = true
	}
	out := &Overlay{Project: project}
	for i := range e.Writable {
		out.Shared = append(out.Shared, fmt.Sprintf("gritqa-writable-%d", i))
	}

	for _, name := range sorted(services) {
		svc, ok := services[name].(map[string]any)
		if !ok {
			continue
		}
		// A fixed name is the original's name, and two containers cannot have it.
		delete(svc, "container_name")
		svc["restart"] = "no"
		svc["labels"] = ours

		for _, p := range published(svc["ports"]) {
			out.Dropped = append(out.Dropped, name+" "+p)
		}
		delete(svc, "ports")
		switch name {
		case e.App:
			svc["ports"] = []any{fmt.Sprintf("%s::%d", loopback, e.Port)}
		case e.Database:
			svc["ports"] = []any{fmt.Sprintf("%s::%d", loopback, e.DBPort)}
		}

		mounts := sealed(svc["volumes"])
		if shares[name] {
			mounts = writable(mounts, e.Writable, out.Shared)
		}
		if len(mounts) == 0 {
			delete(svc, "volumes")
			continue
		}
		svc["volumes"] = mounts
	}

	for _, block := range []string{"volumes", "networks"} {
		out.Detached = append(out.Detached, scope(doc[block], block)...)
	}
	if len(out.Shared) > 0 {
		vols, _ := doc["volumes"].(map[string]any)
		if vols == nil {
			vols = map[string]any{}
			doc["volumes"] = vols
		}
		for _, v := range out.Shared {
			vols[v] = map[string]any{"labels": ours}
		}
	}

	body, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	out.Document = append(body, '\n')
	return out, nil
}

// ours is how GritQA finds its own leftovers. Compose scopes everything by project
// name, which is enough to tear a stack down but not to sweep for one: a filter
// cannot match a name by prefix, so a stack whose process was killed before it
// could run `down` leaves containers, networks and volumes nothing knows to look
// for. Measured: a network from a project called shop, orphaned for a day, while
// `docker ps -a --filter label=gritqa=1` reported clean with two GritQA containers
// running -- the label the verification checked for was never set on anything.
var ours = map[string]any{"gritqa": "1"}

// scope drops the identity compose resolved into its own output, and marks what is
// left. Left in, a volume called hotel_db-data stays hotel_db-data whatever project
// mounts it, and the copy would be writing to the developer's data. Dropping
// `external` is the moment an entry stops being something the developer is running
// and becomes the copy's own, which is why the mark goes on here.
func scope(block any, kind string) []string {
	entries, _ := block.(map[string]any)
	var detached []string
	for _, name := range sorted(entries) {
		entry, ok := entries[name].(map[string]any)
		if !ok {
			// Declared with nothing under it, which is the common case and already
			// project-scoped. A nil has to become an object so a later key can go in.
			entries[name] = map[string]any{"labels": ours}
			continue
		}
		if ext, ok := entry["external"]; ok && truthy(ext) {
			detached = append(detached, kind+" "+name)
		}
		delete(entry, "external")
		delete(entry, "name")
		entry["labels"] = ours
	}
	return detached
}

// sealed makes every bind mount read-only. A bind reaches out of the copy and
// into the developer's working tree, which is the one place a run must not write.
func sealed(block any) []any {
	mounts, _ := block.([]any)
	out := make([]any, 0, len(mounts))
	for _, m := range mounts {
		if entry, ok := m.(map[string]any); ok && entry["type"] == "bind" {
			entry["read_only"] = true
		}
		out = append(out, m)
	}
	return out
}

// writable puts a volume over each path the environment named, replacing whatever
// was mounted there: two mounts on one target is an error, and the volume is the
// one that has to win.
func writable(mounts []any, paths, names []string) []any {
	if len(paths) == 0 {
		return mounts
	}
	over := map[string]bool{}
	for _, p := range paths {
		over[p] = true
	}
	out := make([]any, 0, len(mounts)+len(paths))
	for _, m := range mounts {
		if entry, ok := m.(map[string]any); ok {
			if target, _ := entry["target"].(string); over[target] {
				continue
			}
		}
		out = append(out, m)
	}
	for i, p := range paths {
		out = append(out, map[string]any{"type": "volume", "source": names[i], "target": p})
	}
	return out
}

// published reads the host ports a service claims, in either compose form.
func published(block any) []string {
	ports, _ := block.([]any)
	var out []string
	for _, p := range ports {
		switch v := p.(type) {
		case string:
			// "3307:3306" or "127.0.0.1:3307:3306". No colon is a container port
			// with an ephemeral host one, which takes nothing from anybody.
			if parts := strings.Split(v, ":"); len(parts) > 1 {
				if host := parts[len(parts)-2]; host != "" {
					out = append(out, host)
				}
			}
		case map[string]any:
			if host := text(v["published"]); host != "" {
				out = append(out, host)
			}
		}
	}
	return out
}

func text(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.Itoa(int(t))
	}
	return ""
}

func truthy(v any) bool {
	b, ok := v.(bool)
	return ok && b
}

func sorted(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

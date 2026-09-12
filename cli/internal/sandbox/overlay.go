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
	// Ignored are the services taken out of the document altogether, and Held the
	// ones left in but kept out of the boot. Both are reported because both are a
	// difference between what the developer runs and what GritQA ran.
	Ignored []string
	Held    []string
	// Sealed is whether the copy was cut off from the internet.
	Sealed bool
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

	// An ignored service is deleted rather than disabled: the safety property should
	// not depend on a flag being read correctly further down. A held one stays in
	// the document behind a profile nothing enables, so a step can still start it by
	// name. Either way nothing left in the file may depend on it, or compose stops
	// on a dependency it cannot satisfy.
	absent := map[string]bool{}
	for _, name := range e.Ignored() {
		if _, ok := services[name]; !ok {
			continue
		}
		delete(services, name)
		absent[name] = true
		out.Ignored = append(out.Ignored, name)
	}
	held := map[string]bool{}
	for _, name := range e.OnDemand() {
		if _, ok := services[name]; !ok {
			continue
		}
		held[name] = true
		absent[name] = true
		out.Held = append(out.Held, name)
	}
	sort.Strings(out.Ignored)
	sort.Strings(out.Held)

	for _, name := range sorted(services) {
		svc, ok := services[name].(map[string]any)
		if !ok {
			continue
		}
		// A fixed name is the original's name, and two containers cannot have it.
		delete(svc, "container_name")
		svc["restart"] = "no"
		svc["labels"] = ours
		if held[name] {
			// Compose enables a service's own profiles when it is named on `run`, so
			// one profile nothing turns on is both halves of on_demand at once.
			svc["profiles"] = []any{HoldProfile}
		}
		detach(svc, absent)

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

	// Egress is denied on the networks rather than per service, which is what makes
	// it hold for a service somebody classified wrongly. A service that declares no
	// network of its own joins `default`, so denying means naming it: compose emits
	// that entry itself in most files, and adding it when it is missing is the
	// difference between denying egress and thinking you did.
	out.Sealed = e.Denied() && len(e.Services) > 0
	if out.Sealed {
		nets, _ := doc["networks"].(map[string]any)
		if nets == nil {
			nets = map[string]any{}
			doc["networks"] = nets
		}
		if _, ok := nets["default"]; !ok {
			nets["default"] = map[string]any{}
		}
		for name := range nets {
			seal(nets, name)
		}
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

// seal cuts one network off from the internet while leaving it reachable from the
// host. `internal: true` is the obvious way and it is the wrong one: measured on
// Docker 28.1.1, an internal network does not publish ports at all -- the port came
// back as `{"8080/tcp": null}` and `compose port` answered `invalid IP:0`. The app
// under test would have been unreachable, which is the entire run.
//
// Turning off the bridge's IP masquerade instead leaves the bridge attached to the
// host, so the kernel still DNATs an inbound loopback port, while an outbound packet
// leaves with a private source address and dies at the first hop. Measured on the
// same daemon: the published port stayed reachable, service-to-service by name
// stayed reachable, and TCP to 1.1.1.1:443 was refused.
//
// One honest gap: name resolution still works, because the daemon's embedded
// resolver does the lookup and not the container. Every outbound thing this is
// meant to stop -- a tunnel dialling home, a worker charging a card, mail going
// out -- needs a TCP connection, and none of them get one. Exfiltration through
// DNS queries alone is not covered, and saying so is cheaper than implying it is.
func seal(nets map[string]any, name string) {
	entry, ok := nets[name].(map[string]any)
	if !ok {
		entry = map[string]any{}
		nets[name] = entry
	}
	// Only a bridge has a masquerade rule to turn off. Anything else is a driver
	// this cannot speak for, and an option it does not understand is a boot failure
	// rather than a safer network.
	if d, _ := entry["driver"].(string); d != "" && d != "bridge" {
		return
	}
	opts, _ := entry["driver_opts"].(map[string]any)
	if opts == nil {
		opts = map[string]any{}
		entry["driver_opts"] = opts
	}
	opts["com.docker.network.bridge.enable_ip_masquerade"] = "false"
}

// HoldProfile is the compose profile an on_demand service sits behind. Nothing
// enables it, so `up` skips the service and `run` starts it anyway.
const HoldProfile = "gritqa-on-demand"

// detach drops the dependencies a service has on something that will not be there.
// Compose refuses to start a stack whose depends_on names a service the document
// does not declare, and it will not wait on one held behind a profile either -- so
// removing the service without removing what points at it turns a safety choice
// into a boot failure.
func detach(svc map[string]any, gone map[string]bool) {
	if len(gone) == 0 {
		return
	}
	switch deps := svc["depends_on"].(type) {
	case map[string]any:
		for name := range deps {
			if gone[name] {
				delete(deps, name)
			}
		}
		if len(deps) == 0 {
			delete(svc, "depends_on")
		}
	case []any:
		kept := make([]any, 0, len(deps))
		for _, d := range deps {
			if name, ok := d.(string); ok && gone[name] {
				continue
			}
			kept = append(kept, d)
		}
		if len(kept) == 0 {
			delete(svc, "depends_on")
			return
		}
		svc["depends_on"] = kept
	}
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

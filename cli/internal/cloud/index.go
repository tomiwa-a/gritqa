package cloud

import (
	"context"
	"net/http"
	"sort"

	"github.com/gritqa/cli/internal/index"
)

// The index mirror.
//
// **The route this posts to does not exist yet.** `/api/cli/index` is the web half
// of M7a and it is owed; this is the shape it has to accept, written down here so
// the two halves were designed against one contract rather than two:
//
//	POST /api/cli/index   Authorization: Bearer <cli token>
//	{ "instanceId": "...", "complete": true, "files": [ { filePath, fileHash,
//	  language, symbols: [{kind,count}], dependencies: [], endpoints: [{method,path}] } ] }
//	-> 200 { "ok": true, "written": n, "removed": n }
//
// `complete` says this is the whole tree, so a file the project no longer has can
// be dropped. Anything else would leave a deleted controller in the mirror for
// ever, and the coverage page counts rows.
//
// The mirror is not correctness-bearing -- `codebase_index`'s own comment says so
// -- which is why the CLI sends what it happens to know and nothing here fails a
// run. `dependencies` goes as an empty list because the index does not track them.
const indexPath = "/api/cli/index"

type IndexFile struct {
	FilePath     string     `json:"filePath"`
	FileHash     string     `json:"fileHash"`
	Language     string     `json:"language"`
	Symbols      []Symbol   `json:"symbols"`
	Dependencies []string   `json:"dependencies"`
	Endpoints    []Endpoint `json:"endpoints"`
}

type Symbol struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

type Endpoint struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

type IndexPush struct {
	InstanceID string      `json:"instanceId"`
	Complete   bool        `json:"complete"`
	Files      []IndexFile `json:"files"`
}

type Indexed struct {
	Written int `json:"written"`
	Removed int `json:"removed"`
}

// PushIndex sends the snapshot as one request. A project big enough for that to be
// unreasonable needs a chunked contract, and that is named as owed rather than
// guessed at here.
func (c *Client) PushIndex(ctx context.Context, push IndexPush) (*Indexed, error) {
	r, err := c.call(ctx, http.MethodPost, indexPath, push)
	if err != nil {
		return nil, err
	}
	if !r.ok() {
		return nil, c.fail(indexPath, r)
	}
	out := &Indexed{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

// Mirror flattens a snapshot into what the mirror holds. Endpoints are grouped
// back onto the file that declared them, which is how the coverage page reads
// them.
func Mirror(instanceID string, snap *index.Snapshot) IndexPush {
	byFile := map[string][]Endpoint{}
	for _, r := range snap.Routes {
		if r.File == "" {
			continue
		}
		byFile[r.File] = append(byFile[r.File], Endpoint{Method: r.Method, Path: r.Path})
	}

	files := make([]IndexFile, 0, len(snap.Files))
	for _, f := range snap.Files {
		// Never nil: all three columns are NOT NULL jsonb, and a null would be
		// refused rather than defaulted.
		found := byFile[f.Path]
		if found == nil {
			found = []Endpoint{}
		}
		files = append(files, IndexFile{
			FilePath:     f.Path,
			FileHash:     cut(f.Hash, 64),
			Language:     cut(f.Language, 50),
			Symbols:      symbols(f),
			Dependencies: []string{},
			Endpoints:    found,
		})
	}
	return IndexPush{InstanceID: instanceID, Complete: true, Files: files}
}

// symbols is counts by kind, because that is what the index keeps. Sorted so two
// pushes of the same file are the same bytes.
func symbols(f index.File) []Symbol {
	out := make([]Symbol, 0, len(f.Symbols))
	for kind, n := range f.Symbols {
		out = append(out, Symbol{Kind: string(kind), Count: n})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out
}

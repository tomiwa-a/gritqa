package app

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/tomiwa-a/gritqa/cli/internal/cloud"
	"github.com/tomiwa-a/gritqa/cli/internal/config"
	"github.com/tomiwa-a/gritqa/cli/internal/creds"
	"github.com/tomiwa-a/gritqa/cli/internal/gitinfo"
	"github.com/tomiwa-a/gritqa/cli/internal/term"
)

// connect returns a client for this server, linking the machine first when there
// is no token for it yet.
func connect(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options) (*cloud.Client, error) {
	c, err := cloud.New(opts.server(), cfg.Root())
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, cloud.ErrUnlinked) {
		return nil, err
	}
	return link(ctx, w, cfg, opts)
}

// link is the device flow. The user code is meant to be read off the screen; the
// token it earns goes straight to the credential store and is never printed, not
// even at --verbose.
func link(ctx context.Context, w *term.Writer, cfg *config.Config, opts Options) (*cloud.Client, error) {
	server := opts.server()
	host, _ := os.Hostname()

	dev, err := cloud.StartDevice(ctx, server, cloud.Machine{
		Hostname:  host,
		LocalPath: cfg.Root(),
		Name:      cfg.Project,
		Branch:    cfg.Branch,
		RepoURL:   gitinfo.RemoteURL(ctx, cfg.Root()),
	})
	if err != nil {
		return nil, err
	}

	w.Write(term.Line{Kind: term.Info, Text: "open " + dev.VerificationURI})
	w.Write(term.Line{Kind: term.Info, Text: "and approve this machine with the code " + dev.UserCode})

	// Best-effort: the link above is the flow, this just saves a copy-paste on
	// machines with a screen. Silent on servers and CI, silent on failure.
	openBrowser(dev.VerificationURI)

	got, err := approved(ctx, w, server, dev)
	if err != nil {
		return nil, err
	}

	store, err := creds.Open()
	if err != nil {
		return nil, err
	}
	key := creds.Key{Server: server, Root: cfg.Root()}
	if err := store.Set(key, creds.Entry{Token: got.Token}); err != nil {
		return nil, err
	}

	if got.Project == nil {
		w.Write(term.Line{Kind: term.OK, Text: "this machine is linked to " + server})
		return nil, errors.New("no project was chosen for it, so there is no queue to watch — " +
			"pick one in the dashboard and run gritqa again")
	}
	w.Write(term.Line{Kind: term.OK, Text: "linked to " + got.Project.Name})
	return &cloud.Client{Server: server, Token: got.Token}, nil
}

func approved(ctx context.Context, w *term.Writer, server string, dev *cloud.Device) (*cloud.Linked, error) {
	said := false
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(dev.Wait()):
		}

		// The server says so with a 410, and this is in case it stops being able to.
		if !dev.ExpiresAt.IsZero() && time.Now().After(dev.ExpiresAt) {
			return nil, cloud.ErrDeviceExpired
		}

		got, err := cloud.PollDevice(ctx, server, dev.DeviceCode)
		if err == nil {
			return got, nil
		}
		if !errors.Is(err, cloud.ErrDevicePending) {
			return nil, err
		}
		if !said {
			said = true
			w.Write(term.Line{Kind: term.Info, Text: "waiting for that to be approved"})
		}
	}
}

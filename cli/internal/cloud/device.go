package cloud

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// Linking a machine. Unauthenticated by necessity — this is the call a machine
// with no credential makes to get one — and it grants nothing until a signed-in
// human approves the code.
var (
	ErrDevicePending = errors.New("waiting for someone to approve this machine")
	ErrDeviceDenied  = errors.New("that request was declined in the dashboard")
	ErrDeviceExpired = errors.New("that code has expired")
)

type Device struct {
	UserCode        string    `json:"userCode"`
	DeviceCode      string    `json:"deviceCode"`
	VerificationURI string    `json:"verificationUri"`
	ExpiresAt       time.Time `json:"expiresAt"`
	Interval        int       `json:"interval"`
}

// Wait is how long to leave between polls.
func (d *Device) Wait() time.Duration {
	if d == nil || d.Interval <= 0 {
		return 2 * time.Second
	}
	return time.Duration(d.Interval) * time.Second
}

type Linked struct {
	Token   string `json:"token"`
	Project *struct {
		PublicID string `json:"publicId"`
		Name     string `json:"name"`
	} `json:"project"`
}

// Machine is how the CLI describes the directory it was started in. All of it is
// for the approval screen: a project the dashboard has never seen is one a human
// is being asked to add, and they can only say yes to something they can read.
type Machine struct {
	Hostname  string `json:"hostname,omitempty"`
	LocalPath string `json:"localPath,omitempty"`
	Name      string `json:"name,omitempty"`
	Branch    string `json:"branch,omitempty"`
	RepoURL   string `json:"repoUrl,omitempty"`
}

// StartDevice asks to be linked and gets back a code worth nothing on its own.
func StartDevice(ctx context.Context, server string, m Machine) (*Device, error) {
	const path = "/api/cli/device"
	c := &Client{Server: server}
	r, err := c.call(ctx, http.MethodPost, path, m)
	if err != nil {
		return nil, err
	}
	if !r.ok() {
		return nil, c.fail(path, r)
	}
	out := &Device{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	return out, nil
}

// PollDevice asks whether a human has answered yet. The three waiting answers are
// errors so a caller can branch on them; only the last one is a credential.
func PollDevice(ctx context.Context, server, deviceCode string) (*Linked, error) {
	const path = "/api/cli/device/token"
	c := &Client{Server: server}
	r, err := c.call(ctx, http.MethodPost, path, struct {
		DeviceCode string `json:"deviceCode"`
	}{deviceCode})
	if err != nil {
		return nil, err
	}

	switch r.Status {
	case http.StatusAccepted:
		return nil, ErrDevicePending
	case http.StatusForbidden:
		return nil, ErrDeviceDenied
	case http.StatusGone:
		return nil, ErrDeviceExpired
	}
	if !r.ok() {
		return nil, c.fail(path, r)
	}

	out := &Linked{}
	if err := r.into(out); err != nil {
		return nil, err
	}
	if out.Token == "" {
		return nil, errors.New("the dashboard approved this machine and sent no token")
	}
	return out, nil
}

//go:build windows

package sandbox

import "os/exec"

func setpgid(*exec.Cmd) {}

func kill(cmd *exec.Cmd) { cmd.Process.Kill() }

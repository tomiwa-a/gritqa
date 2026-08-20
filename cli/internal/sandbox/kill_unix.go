//go:build !windows

package sandbox

import (
	"os/exec"
	"syscall"
)

// setpgid puts the child in its own process group so kill can take the whole
// tree: php -S forks workers, and killing the shell alone leaves the port held.
func setpgid(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func kill(cmd *exec.Cmd) {
	if pgid, err := syscall.Getpgid(cmd.Process.Pid); err == nil && pgid == cmd.Process.Pid {
		syscall.Kill(-pgid, syscall.SIGTERM)
		return
	}
	cmd.Process.Kill()
}

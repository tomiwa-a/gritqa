package app

import (
	"os"
	"os/exec"
	"runtime"
)

// openBrowser opens url in the default browser. Best-effort by design: the link
// is always printed first, so this never carries the flow — a headless machine
// skips silently and anything else fails quietly.
func openBrowser(url string) {
	if headless() {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// headless reports the environments where no browser could open: remote shells,
// dumb terminals, and CI runners.
func headless() bool {
	if os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_TTY") != "" {
		return true
	}
	if os.Getenv("TERM") == "dumb" {
		return true
	}
	for _, v := range []string{"CI", "CONTINUOUS_INTEGRATION", "BUILD_ID", "GITHUB_ACTIONS"} {
		if os.Getenv(v) != "" {
			return true
		}
	}
	return false
}

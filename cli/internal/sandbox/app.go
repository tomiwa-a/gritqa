package sandbox

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// AppOptions describes how to bring the project's own API up against the sandbox.
type AppOptions struct {
	// Start overrides the recipe's own serve command. It is run.start, as written.
	Start string
	// Port is the port the app listens on inside the container.
	Port int
	Env  map[string]string
	// Ready is a "GET /health" probe. Empty settles for anything answering.
	Ready string
	// Root is the working directory for the host path, which is what runtime: host
	// falls back to.
	Root string
}

// defaultAppPort is what the serve command binds to inside the container when
// run.port says nothing. The published host port is chosen by docker.
const defaultAppPort = 8080

// App is the API GritQA started. It is never the user's own server: their Apache
// keeps serving their real database, untouched, on its own port.
type App struct {
	BaseURL string
	// How is the one line the transcript prints about where this came from.
	How string

	box       *Sandbox
	container string

	cmd  *exec.Cmd
	done chan struct{}
	tail *ring
	once sync.Once
}

// StartApp brings the API up against the sandbox. With an image it runs in a
// container on this run's network, which is what makes the mechanism
// language-neutral: nothing here knows what the project is written in, only that
// a command serves it.
func (s *Sandbox) StartApp(ctx context.Context, opts AppOptions) (*App, error) {
	if s.image == "" {
		return s.startOnHost(ctx, opts)
	}

	serve := strings.TrimSpace(opts.Start)
	if serve == "" {
		serve = strings.TrimSpace(s.recipe.Serve)
	}
	if serve == "" {
		return nil, fmt.Errorf("nothing says how to serve this project — add run.start to %s "+
			"with the command that brings your API up, and $PORT and $DOCROOT are set for it",
			".gritqa/config.yaml")
	}

	inner := opts.Port
	if inner == 0 {
		inner = defaultAppPort
	}

	name := s.appName()
	args, err := s.appArgs(name, opts, inner, serve)
	if err != nil {
		return nil, err
	}
	if _, err := s.docker(ctx, args...); err != nil {
		return nil, fmt.Errorf("could not start your API: %w", err)
	}

	app := &App{box: s, container: name, How: s.recipe.Describe()}
	port, err := s.mappedPortOf(ctx, name, inner)
	if err != nil {
		app.Stop(context.WithoutCancel(ctx))
		return nil, err
	}
	app.BaseURL = fmt.Sprintf("http://%s:%d", loopback, port)

	if err := app.await(ctx, opts.Ready, 40*time.Second); err != nil {
		app.Stop(context.WithoutCancel(ctx))
		return nil, err
	}
	return app, nil
}

// appName is derived rather than stored, so teardown can remove the app container
// without having been handed one.
func (s *Sandbox) appName() string { return s.name + "-app" }

// appArgs builds the docker run. The source is read-only, so a run cannot write
// into the user's tree; each writable directory is a volume GritQA owns, which is
// what closes the gap M4 had to report as open.
func (s *Sandbox) appArgs(name string, opts AppOptions, inner int, serve string) ([]string, error) {
	r := s.recipe
	envFile, err := s.containerEnvFile(name, map[string]string{
		"PORT":    fmt.Sprint(inner),
		"DOCROOT": containerPath("/app", filepath.Join(r.Workdir, r.Docroot)),
	}, opts.Env)
	if err != nil {
		return nil, err
	}

	args := append([]string{"run", "-d", "--name", name}, s.containerArgs(envFile)...)
	args = append(args, "-p", fmt.Sprintf("%s::%d", loopback, inner))
	return append(args, s.image, "sh", "-c", serve), nil
}

// containerUser matters on Linux alone. There, container root writing into a
// bind-mounted directory leaves files this process cannot delete; on Docker
// Desktop the write already lands as the host user, and forcing a uid there
// breaks more than it fixes.
func containerUser() string {
	if runtime.GOOS != "linux" {
		return ""
	}
	return fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid())
}

func (s *Sandbox) mappedPortOf(ctx context.Context, name string, container int) (int, error) {
	out, err := s.docker(ctx, "port", name, fmt.Sprintf("%d/tcp", container))
	if err != nil {
		return 0, err
	}
	return firstPort(out, container)
}

// startOnHost is runtime: host — the documented escape hatch for a machine with
// no Docker, or a project whose environment the user would rather own. run.start
// is required, because guessing at a language's serve command is what M4b set out
// to stop doing.
func (s *Sandbox) startOnHost(ctx context.Context, opts AppOptions) (*App, error) {
	line := strings.TrimSpace(opts.Start)
	if line == "" {
		return nil, fmt.Errorf("run.sandbox.runtime is host, so GritQA runs your own command — " +
			"add run.start with the line that serves your API")
	}
	port := opts.Port
	if port == 0 {
		var err error
		if port, err = freePort(); err != nil {
			return nil, err
		}
	}

	name, flag := "sh", "-c"
	if runtime.GOOS == "windows" {
		name, flag = "cmd", "/c"
	}
	cmd := exec.Command(name, flag, line)
	cmd.Dir = opts.Root
	cmd.Env = append(s.environ(opts.Env), fmt.Sprintf("PORT=%d", port))

	tail := &ring{max: 20}
	cmd.Stdout, cmd.Stderr = tail, tail
	setpgid(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	app := &App{
		BaseURL: fmt.Sprintf("http://%s:%d", loopback, port),
		How:     "your own command, on this machine",
		cmd:     cmd,
		done:    make(chan struct{}),
		tail:    tail,
	}
	go func() {
		cmd.Wait()
		close(app.done)
	}()

	if err := app.await(ctx, opts.Ready, 20*time.Second); err != nil {
		app.Stop(context.WithoutCancel(ctx))
		return nil, err
	}
	return app, nil
}

// await waits for the API to answer, and gives up early when it has already died
// rather than spending the whole timeout on a corpse.
func (a *App) await(ctx context.Context, ready string, limit time.Duration) error {
	method, path := "GET", "/"
	if f := strings.Fields(ready); len(f) == 2 {
		method, path = strings.ToUpper(f[0]), f[1]
	} else if len(f) == 1 {
		path = f[0]
	}

	client := &http.Client{Timeout: 3 * time.Second}
	deadline := time.Now().Add(limit)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if dead, why := a.dead(ctx); dead {
			return fmt.Errorf("the API exited before it answered: %s", why)
		}

		req, err := http.NewRequestWithContext(ctx, method, a.BaseURL+path, nil)
		if err != nil {
			return err
		}
		if res, err := client.Do(req); err == nil {
			res.Body.Close()
			if ready == "" || res.StatusCode < 400 {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the API never answered on %s within %s — %s", a.BaseURL, limit, a.Tail())
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// Container is the container this app is running in, empty for the host path. It
// goes on the run report: "which machine" is answered by the instance id, and
// "which copy of the app" by this.
func (a *App) Container() string {
	if a == nil {
		return ""
	}
	return a.container
}

func (a *App) dead(ctx context.Context) (bool, string) {
	if a.container != "" {
		running, why := a.box.aliveNamed(ctx, a.container)
		if running {
			return false, ""
		}
		return true, why
	}
	select {
	case <-a.done:
		return true, a.tail.last()
	default:
		return false, ""
	}
}

// Stop removes the container, or kills the host process group — a built-in dev
// server spawns workers, and killing only the shell would leave the port held.
func (a *App) Stop(ctx context.Context) error {
	if a == nil {
		return nil
	}
	var err error
	a.once.Do(func() {
		if a.container != "" {
			_, err = a.box.docker(ctx, "rm", "-f", "-v", a.container)
			return
		}
		if a.cmd == nil || a.cmd.Process == nil {
			return
		}
		kill(a.cmd)
		select {
		case <-a.done:
		case <-time.After(3 * time.Second):
		}
	})
	return err
}

// Tail is the last of the API's own output, for explaining a failure.
func (a *App) Tail() string {
	if a == nil {
		return ""
	}
	if a.container != "" {
		out, err := a.box.docker(context.Background(), "logs", "--tail", "12", a.container)
		if err != nil || strings.TrimSpace(out) == "" {
			return "it printed nothing"
		}
		return lastLine(out)
	}
	if a.tail == nil {
		return ""
	}
	return a.tail.last()
}

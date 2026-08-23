package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gritqa/cli/internal/run"
)

func testbox(t *testing.T) *Sandbox {
	t.Helper()
	img, err := Lookup("mysql:8")
	if err != nil {
		t.Fatal(err)
	}
	c, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	return &Sandbox{
		img: img, creds: c, name: "gritqa-test-0001",
		host: loopback, port: 54321, dir: t.TempDir(),
		watcher: NewWatcher(nil, img.Driver, c),
		log:     func(string) {},
	}
}

func TestNewCredsGeneratesTheSecret(t *testing.T) {
	img, _ := Lookup("mysql:8")
	a, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := newCreds(img, "")
	if err != nil {
		t.Fatal(err)
	}
	if a.Password == b.Password {
		t.Fatal("two sandboxes got the same password")
	}
	if len(a.Password) < 24 {
		t.Errorf("password is %d characters, which is guessable", len(a.Password))
	}
	if a.Database != defaultDatabase {
		t.Errorf("database = %q, want %q", a.Database, defaultDatabase)
	}
	if got, _ := newCreds(img, "hotel_test"); got.Database != "hotel_test" {
		t.Errorf("database = %q, want the configured one", got.Database)
	}
}

// The password must not reach anything a person or a log file gets to see. Each
// case below is a real surface: an argument list is world-readable through ps, a
// failed docker command is quoted back to the user, and a recorded run is written
// to cache.db.
func TestTheGeneratedPasswordStaysOut(t *testing.T) {
	s := testbox(t)
	pw := s.creds.Password

	// ps shows every argument of every process on the machine.
	for _, arg := range s.runArgs(s.img, filepath.Join(s.dir, "env")) {
		if strings.Contains(arg, pw) {
			t.Errorf("docker run argv carries the password: %q", arg)
		}
	}

	// Anything docker or a migration prints is scrubbed before it is reported.
	noisy := "Access denied for user 'root'@'localhost' (using password: " + pw + ")\n" +
		"and again: " + pw
	if got := s.creds.scrub(noisy); strings.Contains(got, pw) {
		t.Errorf("scrub left the password in %q", got)
	}
	if !strings.Contains(s.creds.scrub(noisy), "•••") {
		t.Error("scrub should say something was hidden")
	}

	// A step's reported URL is masked against exactly this list.
	if got := s.Secrets(); len(got) != 1 || got[0] != pw {
		t.Errorf("Secrets() = %v, want the generated password", got)
	}

	// A built image's Dockerfile is written to disk and its tag is a build
	// argument, so neither may carry the credential.
	s.Use(Recipe{Base: "php:8.2-cli", Mount: t.TempDir(), Fingerprint: "abc"}, "")
	body, err := s.recipe.Dockerfile()
	if err != nil {
		t.Fatal(err)
	}
	dir, file, err := s.buildContext(s.recipe, body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(dir, s.dir) {
		t.Errorf("the build context is at %s, want it under %s", dir, s.dir)
	}
	rendered, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rendered), pw) {
		t.Error("the rendered Dockerfile carries the password")
	}

	// The state ledger is the one thing about the sandbox that gets recorded.
	moved := mark(Row{Name: "guests", Rows: 2, High: "43"}).Diff(mark(Row{Name: "guests", Rows: 1, High: "41"}))
	for _, m := range moved {
		if strings.Contains(m.Unit+m.From+m.To, pw) {
			t.Errorf("the ledger carries the password: %+v", m)
		}
	}
}

// The app container learns where its database is through an env file, because an
// argument list is world-readable through ps. What matters is that the file is
// 0600 and in GritQA's own temp directory: nothing is written into the user's tree.
func TestTheAppContainerKeepsTheSecretInAFile(t *testing.T) {
	s := testbox(t)
	project := t.TempDir()
	s.Use(Recipe{Base: "php:8.2-cli", Mount: project, Workdir: "api"}, "gritqa-app:test")

	args, err := s.appArgs(s.name+"-app", AppOptions{}, 8080, "php -S 0.0.0.0:$PORT")
	if err != nil {
		t.Fatal(err)
	}

	pw := s.creds.Password
	for _, a := range args {
		if strings.Contains(a, pw) {
			t.Errorf("docker run argv carries the password: %q", a)
		}
	}

	envFile := ""
	for i, a := range args {
		if a == "--env-file" && i+1 < len(args) {
			envFile = args[i+1]
		}
	}
	if envFile == "" {
		t.Fatal("the container was given no env file")
	}
	if filepath.Dir(envFile) != s.dir {
		t.Errorf("the env file is at %s, want it under %s", envFile, s.dir)
	}
	info, err := os.Stat(envFile)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("the env file is %o, want 600", mode)
	}

	body, err := os.ReadFile(envFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "DB_PASSWORD="+pw) {
		t.Error("the app cannot reach the sandbox without the password")
	}
	// Over the run's network, not the mapped loopback port, which is the host's.
	if !strings.Contains(string(body), "DB_HOST="+dbAlias) {
		t.Errorf("the app was pointed at %s", "something other than "+dbAlias)
	}

	if entries, _ := os.ReadDir(project); len(entries) != 0 {
		t.Errorf("the project directory gained files: %v", entries)
	}
}

// The source is mounted read-only and each writable directory is a volume GritQA
// owns, which is what closes the gap M4 had to report as open.
func TestWritableDirectoriesAreNotTheUsersTree(t *testing.T) {
	s := testbox(t)
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "api", "uploads", "room_type"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(project, "api", "uploads", "room_type", "old.jpg"), "x")
	s.Use(Recipe{Base: "php:8.2-cli", Mount: project, Workdir: "api", Writable: []string{"uploads"}}, "img")
	if err := s.MakeWritable(); err != nil {
		t.Fatal(err)
	}

	// The skeleton is there so an app writing to uploads/room_type/ can, and none
	// of the user's own files are, so the baseline is the same on any machine.
	vol := filepath.Join(s.dir, "writable", "uploads")
	if _, err := os.Stat(filepath.Join(vol, "room_type")); err != nil {
		t.Errorf("the directory skeleton was not mirrored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(vol, "room_type", "old.jpg")); err == nil {
		t.Error("the volume inherited a file, so two machines would baseline differently")
	}

	args := s.containerArgs(filepath.Join(s.dir, "env"))
	if !contains(args, project+":/app:ro") {
		t.Errorf("the source is not mounted read-only: %v", args)
	}
	want := filepath.Join(s.dir, "writable", "uploads") + ":/app/api/uploads"
	if !contains(args, want) {
		t.Errorf("uploads is not a volume GritQA owns: %v", args)
	}
	// And the ledger counts that volume, so it keeps reporting uploads honestly.
	if got := s.watcher.Watching(); len(got) != 1 ||
		got[0] != filepath.Join(s.dir, "writable", "uploads") {
		t.Errorf("the ledger watches %v", got)
	}
}

func TestWritableRefusesAPathOutOfTheProject(t *testing.T) {
	s := testbox(t)
	s.Use(Recipe{Mount: t.TempDir(), Writable: []string{"../../etc"}}, "img")
	if err := s.MakeWritable(); err == nil {
		t.Fatal("a writable directory above the project was accepted")
	}
}

func contains(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

func TestEnvNamesBothConventions(t *testing.T) {
	env := testbox(t).Env()
	for _, k := range []string{"DB_HOST", "DB_PORT", "DB_NAME", "DB_DATABASE",
		"DB_USER", "DB_USERNAME", "DB_PASSWORD", "DB_CONNECTION", "DATABASE_URL"} {
		if env[k] == "" {
			t.Errorf("Env() has no %s", k)
		}
	}
	if env["DB_HOST"] != loopback {
		t.Errorf("DB_HOST = %q, want loopback", env["DB_HOST"])
	}
	if env["DB_PORT"] != "54321" {
		t.Errorf("DB_PORT = %q, want the mapped port", env["DB_PORT"])
	}

	// A container on the run's network reaches the database by alias instead, on
	// its own port. The mapped one belongs to the host.
	in := testbox(t).ContainerEnv()
	if in["DB_HOST"] != dbAlias || in["DB_PORT"] != "3306" {
		t.Errorf("ContainerEnv points at %s:%s", in["DB_HOST"], in["DB_PORT"])
	}
	if !strings.Contains(in["DATABASE_URL"], "@"+dbAlias+":3306/") {
		t.Errorf("DATABASE_URL = %q, want the alias", in["DATABASE_URL"])
	}
}

func TestContainerNameIsAccountableAndUnique(t *testing.T) {
	a, b := containerName("Hotel Management"), containerName("Hotel Management")
	if a == b {
		t.Error("two runs of the same project collided on one container name")
	}
	for _, got := range []string{a, containerName(""), containerName("../../etc")} {
		if !strings.HasPrefix(got, "gritqa-") {
			t.Errorf("%q should say who made it", got)
		}
		if strings.ContainsAny(got, " /.:") {
			t.Errorf("%q is not a legal container name", got)
		}
	}
}

// Engine.State is optional in exactly the way Repairer is, and Watermark is what
// satisfies it.
var (
	_ run.State = (*Sandbox)(nil)
	_ run.Mark  = (*Watermark)(nil)
)

func TestWatermarkStamped(t *testing.T) {
	w := &Watermark{At: time.Now()}
	if w.At.IsZero() {
		t.Error("a reading with no time cannot be ordered against another")
	}
}

// Docker puts the reason first and a useless "Run 'docker run --help'" last, and
// a denied mount is a Docker Desktop setting that unexplained reads as a bug here.
func TestDockerErrorsSayWhatWentWrong(t *testing.T) {
	if got := dockerReason("docker: no such image: x\n\nRun 'docker run --help' for more information\n"); got != "docker: no such image: x" {
		t.Errorf("dockerReason = %q", got)
	}
	denied := "docker: Error response from daemon: Mounts denied: \n" +
		"The path /Applications/XAMPP/xamppfiles/htdocs/hotel is not shared from the host " +
		"and is not known to Docker.\nRun 'docker run --help' for more information\n"
	got := dockerReason(denied)
	if !strings.Contains(got, "/Applications/XAMPP/xamppfiles/htdocs/hotel") {
		t.Errorf("the reason does not name the path: %q", got)
	}
	if !strings.Contains(got, "File Sharing") || !strings.Contains(got, "run.sandbox.mount") {
		t.Errorf("the reason does not say what to do: %q", got)
	}
	if dockerReason("   \n") != "no output" {
		t.Error("an empty failure should still say something")
	}
}

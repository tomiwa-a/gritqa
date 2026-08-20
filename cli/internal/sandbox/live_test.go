package sandbox

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// live is the real thing: Docker, a real MySQL, a real dump replayed. Off by
// default because it costs half a minute and a 1.1 GB image, and the rest of the
// package's tests have to stay runnable on a machine with neither.
func live(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("GRITQA_SANDBOX_TEST") != "1" {
		t.Skip("set GRITQA_SANDBOX_TEST=1 to run the Docker-backed tests")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker on PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	t.Cleanup(cancel)
	return ctx
}

// TestResetUndoesWritesTakenAfterTheBaseline is decision 27's proof, in one
// session: research writes to the same database execution runs against, so the
// restore has to put those rows back rather than merge over them.
func TestResetUndoesWritesTakenAfterTheBaseline(t *testing.T) {
	ctx := live(t)

	box, err := Up(ctx, Options{Image: "mysql:8", Database: "gritqa_live", Project: "live-test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { box.Down(context.Background()) })

	must := func(q string) {
		t.Helper()
		if _, err := box.DB().ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	must("CREATE TABLE things (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40))")
	must("INSERT INTO things (name) VALUES ('one'), ('two')")

	if err := box.Baseline(ctx); err != nil {
		t.Fatal(err)
	}
	if box.BaselineBytes() <= 0 {
		t.Fatal("the baseline reported no bytes")
	}

	before, err := box.Mark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	must("INSERT INTO things (name) VALUES ('three'), ('four'), ('five')")

	after, err := box.Watermark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	moved := after.Diff(before)
	if len(moved) != 1 || moved[0].Unit != "things" || moved[0].Rows != 3 {
		t.Fatalf("expected things +3, got %+v", moved)
	}
	if moved[0].From != "2" || moved[0].To != "5" {
		t.Fatalf("expected the key to move 2 → 5, got %s → %s", moved[0].From, moved[0].To)
	}

	if err := box.Reset(ctx); err != nil {
		t.Fatal(err)
	}

	var rows int64
	var hi int64
	if err := box.DB().QueryRowContext(ctx,
		"SELECT COUNT(*), COALESCE(MAX(id), 0) FROM things").Scan(&rows, &hi); err != nil {
		t.Fatal(err)
	}
	if rows != 2 || hi != 2 {
		t.Fatalf("after the reset the table holds %d rows up to %d, want 2 up to 2", rows, hi)
	}

	// The pool was rebuilt over a database that had been dropped, so the ledger
	// has to have re-learnt what it watches.
	if got := box.Tables(); len(got) != 1 || got[0] != "things" {
		t.Fatalf("after the reset the ledger watches %v", got)
	}
}

// TestDownLeavesNoContainer is the promise that docker ps never shows something
// the user cannot account for.
func TestDownLeavesNoContainer(t *testing.T) {
	ctx := live(t)

	box, err := Up(ctx, Options{Image: "mysql:8", Database: "gritqa_live", Project: "live-test"})
	if err != nil {
		t.Fatal(err)
	}
	name := box.Name()
	if !running(t, name) {
		t.Fatalf("%s is not running after Up", name)
	}
	if err := box.Down(ctx); err != nil {
		t.Fatal(err)
	}
	if running(t, name) {
		t.Fatalf("%s survived Down", name)
	}
	if err := box.Down(ctx); err != nil {
		t.Fatalf("a second Down should be harmless: %v", err)
	}
}

func running(t *testing.T, name string) bool {
	t.Helper()
	out, err := exec.Command("docker", "ps", "-a", "-q", "--filter", "name=^"+name+"$").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out)) != ""
}

// TestTheAppRunsInAContainerAndReachesTheSandbox is M4b's whole claim in one
// session: a recipe derived with no model builds an image the language runtime
// does not ship, the app reads its database out of the process environment with
// no generated shim, and what it writes lands somewhere GritQA owns.
func TestTheAppRunsInAContainerAndReachesTheSandbox(t *testing.T) {
	ctx := live(t)
	root := livePHPProject(t)

	box, err := Up(ctx, Options{Image: "mysql:8", Database: "gritqa_live", Project: "live-app"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { box.Down(context.Background()) })

	r, err := DeriveRecipe(RecipeInput{Root: root, Language: "php", Config: Recipe{Writable: []string{"uploads"}}})
	if err != nil {
		t.Fatal(err)
	}
	image, err := box.Build(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	box.Use(r, image)

	// The measured blocker M4b exists for: php:8.2-cli ships neither pdo_mysql nor
	// mysqli, so the recipe has to build them in.
	mods, err := exec.Command("docker", "run", "--rm", image, "php", "-m").Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mods), "pdo_mysql") {
		t.Fatal("the built image cannot reach MySQL, so nothing below could have worked")
	}

	// Migrations run inside that image too, which is where the project's toolchain
	// lives — and they reach the database by alias, not by a mapped host port.
	if _, err := box.Prepare(ctx, root, []Command{
		{Label: "migrated", Line: `php -r '(new PDO("mysql:host=".getenv("DB_HOST").";dbname=".getenv("DB_NAME"), getenv("DB_USER"), getenv("DB_PASSWORD")))->exec("CREATE TABLE things (id INT AUTO_INCREMENT PRIMARY KEY)");'`},
	}, nil); err != nil {
		t.Fatal(err)
	}

	if err := box.MakeWritable(); err != nil {
		t.Fatal(err)
	}
	if err := box.Baseline(ctx); err != nil {
		t.Fatal(err)
	}

	app, err := box.StartApp(ctx, AppOptions{Ready: "GET /probe.php"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Stop(context.Background()) })

	// $_ENV, unset by XAMPP's variables_order and never written by phpdotenv's
	// immutable repository, arrives populated in the container with no shim.
	body := get(t, app.BaseURL+"/probe.php")
	if !strings.Contains(body, "db=gritqa_live") {
		t.Errorf("the app did not see the sandbox in $_ENV: %s", body)
	}
	if !strings.Contains(body, "tables=1") {
		t.Errorf("the app did not reach the sandbox over the run's network: %s", body)
	}

	before, err := box.Mark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if body := get(t, app.BaseURL+"/probe.php?write=1"); !strings.Contains(body, "wrote=1") {
		t.Fatalf("the app could not write to its uploads directory: %s", body)
	}

	// The upload landed in the volume, and the user's own tree never saw it.
	if entries, _ := os.ReadDir(filepath.Join(root, "uploads")); len(entries) != 0 {
		t.Errorf("the project's uploads directory gained %d files", len(entries))
	}
	if _, err := os.Stat(filepath.Join(box.volumes[0].host, "probe.txt")); err != nil {
		t.Errorf("the upload is nowhere GritQA owns: %v", err)
	}

	// And the ledger still reports it, now measuring the volume.
	after, err := box.Watermark(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range after.Diff(before) {
		if m.Unit == "files:uploads" && m.Rows == 1 {
			found = true
		}
	}
	if !found {
		t.Errorf("the ledger did not report the upload: %+v", after.Diff(before))
	}

	// Teardown owns the app container and the network as well as the database, and
	// it does so without having been told the app was ever started.
	net, appc := box.Network(), box.appName()
	if err := box.Down(ctx); err != nil {
		t.Fatal(err)
	}
	if running(t, appc) {
		t.Errorf("%s survived Down", appc)
	}
	out, err := exec.Command("docker", "network", "ls", "-q", "--filter", "name=^"+net+"$").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Errorf("%s survived Down", net)
	}
}

// livePHPProject is the smallest project the table can boot: a manifest naming
// the package manager, vendor/ already present so nothing is installed, and one
// file that reports what the container gave it.
func livePHPProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"vendor", "uploads"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write(t, filepath.Join(root, "composer.json"), `{"require":{}}`)
	write(t, filepath.Join(root, "probe.php"), `<?php
$db = new PDO("mysql:host={$_ENV['DB_HOST']};port={$_ENV['DB_PORT']};dbname={$_ENV['DB_NAME']}",
  $_ENV['DB_USER'], $_ENV['DB_PASSWORD']);
$n = $db->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '{$_ENV['DB_NAME']}'")->fetchColumn();
$wrote = isset($_GET['write']) ? (int) (bool) file_put_contents(__DIR__ . '/uploads/probe.txt', 'x') : 0;
echo "db={$_ENV['DB_NAME']} tables={$n} wrote={$wrote}";
`)
	return root
}

func get(t *testing.T, url string) string {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

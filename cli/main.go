package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/gritqa/cli/internal/app"
	"github.com/gritqa/cli/internal/term"
)

// Set by goreleaser via -ldflags.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	var opts app.Options

	cmd := &cobra.Command{
		Use:   "gritqa",
		Short: "Reads your backend, drafts test plans, runs the ones you approve",
		Long: "gritqa reads the project in the current directory, drafts test plans for what\n" +
			"changed, and waits while you review them. Approve one in the dashboard and this\n" +
			"process runs it against a throwaway database on your machine.\n\n" +
			"Press Ctrl-C to stop.",
		Version:       version,
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return app.Run(cmd.Context(), opts)
		},
	}

	cmd.SetVersionTemplate(
		fmt.Sprintf("gritqa %s (%s, built %s)\n", version, commit, date),
	)

	f := cmd.Flags()
	f.BoolVar(&opts.Once, "once", false, "read and draft, then exit instead of waiting")
	f.BoolVar(&opts.Draft, "draft", false, "draft plans for what changed, write them to .gritqa/drafts/, exit")
	f.StringVar(&opts.PlanFile, "plan", "", "run one plan JSON locally, without a server")
	f.StringVar(&opts.Project, "project", "", "project name, when there is no config yet")
	f.BoolVar(&opts.Verbose, "verbose", false, "plain unaligned output, for logs")
	f.BoolVar(&opts.JSON, "json", false, "NDJSON output, one event per line")
	f.BoolVar(&opts.Logout, "logout", false, "forget the stored token and exit")
	f.StringVar(&opts.ConfigPath, "config", "", "path to config.yaml")
	f.StringVar(&opts.Server, "server", "", "dashboard base URL (default https://app.gritqa.dev)")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := cmd.ExecuteContext(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			os.Exit(130)
		}
		w := term.New(os.Stderr)
		if opts.Verbose || opts.JSON {
			w = w.Plain()
		}
		w.Write(term.Line{Kind: term.Fail, Text: err.Error()})
		os.Exit(1)
	}
}

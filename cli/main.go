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
		Version: version,
		Args: func(cmd *cobra.Command, args []string) error {
			// --serve carries NoOptDefVal so a bare --serve means stdio, which also
			// means an address has to be attached with an equals sign.
			if len(args) > 0 && cmd.Flags().Changed("serve") {
				return fmt.Errorf("--serve takes its address attached: --serve=%s", args[0])
			}
			return cobra.NoArgs(cmd, args)
		},
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
	f.StringSliceVar(&opts.Only, "only", nil, "draft for these controllers or endpoints, whatever changed")
	f.BoolVar(&opts.All, "all", false, "draft for every file that registers an endpoint")
	f.StringVar(&opts.Describe, "describe", "", "draft one plan from this brief, in your own words")
	f.StringVar(&opts.Name, "name", "", "title for the plan --describe writes")
	f.StringVar(&opts.PlanFile, "plan", "", "run one plan JSON locally, without a server")
	f.BoolVar(&opts.NoConfirm, "no-confirm", false, "skip the model's check that a green run proved anything")
	f.StringVar(&opts.Project, "project", "", "project name, when there is no config yet")
	f.BoolVar(&opts.Verbose, "verbose", false, "plain unaligned output, for logs")
	f.BoolVar(&opts.JSON, "json", false, "NDJSON output, one event per line")
	f.BoolVar(&opts.Logout, "logout", false, "forget the stored token and exit")
	f.StringVar(&opts.ConfigPath, "config", "", "path to config.yaml")
	f.StringVar(&opts.Server, "server", "", "dashboard base URL (default https://app.gritqa.dev)")
	f.StringVar(&opts.Serve, "serve", "", "serve this project's tools over MCP; bare for stdio, or --serve=127.0.0.1:7391")
	f.Lookup("serve").NoOptDefVal = "stdio"
	opts.Version = version
	f.BoolVar(&opts.Execute, "execute", false, "also serve the tools that run plans and tear the sandbox down")

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

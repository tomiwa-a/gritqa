import Link from 'next/link';
import { Modal } from '../modal';
import { CopyCommand } from '../copy-command';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * The new-project explainer, opened from the project switcher.
 *
 * Nothing in the browser inserts a project row — the CLI does, when its pairing
 * is approved — so this box teaches the three moves instead of offering a form.
 * A form here would be the lie the gate was built to avoid: typing a name cannot
 * create something the tools have never read.
 */
export function NewProjectModal({ closeHref }: { closeHref: string }) {
  return (
    <Modal
      id="new-project"
      closeHref={closeHref}
      label="New project"
      eyebrow="how projects are born"
      title="Run it once in a repo"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href={closeHref}
            scroll={false}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Close
          </Link>
          <Link
            href="/onboarding"
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }))}
          >
            Setup guide
            <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      }
    >
      <ol className="flex flex-col gap-4 p-4">
        <li className="flex items-start gap-3">
          <span className="nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule-strong font-mono text-[11px] text-ink-muted">
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">Put the CLI on your machine</p>
            <CopyCommand
              className="mt-2"
              command="go install github.com/tomiwa-a/gritqa/cli@latest"
            />
          </div>
        </li>

        <li className="flex items-start gap-3">
          <span className="nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule-strong font-mono text-[11px] text-ink-muted">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">Run it inside the repo</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">
              From the folder holding your go.mod, package.json, or requirements.txt. It reads
              your routes and prints a pairing code.
            </p>
            <CopyCommand className="mt-2" command="gritqa" />
          </div>
        </li>

        <li className="flex items-start gap-3">
          <span className="nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule-strong font-mono text-[11px] text-ink-muted">
            3
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">Approve the pairing here</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">
              Open the link it prints and approve it. That approval is what creates the project —
              codes last ten minutes and each one works once.
            </p>
          </div>
        </li>
      </ol>
    </Modal>
  );
}

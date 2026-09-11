import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { CodeBlock } from '@/components/ui/code-block';
import { buttonVariants } from '@/components/ui/button';
import { CopyCommand } from '../copy-command';
import { getCurrentProject, getMachineStatus } from '@/lib/data';
import { cn } from '@/lib/cn';

export function InstallStep() {
  return (
    <div className="flex flex-col gap-4">
      <CopyCommand label="If you have Go" command="go install github.com/tomiwa-a/gritqa/cli@latest" />

      <div className="flex items-start gap-3 rounded-lg border border-rule bg-app p-3">
        <Icon name="external" size={15} className="mt-0.5 shrink-0 text-ink-subtle" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">Or take a pre-built binary</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">
            macOS, Linux, and Windows builds are attached to every release. Unpack it and put{' '}
            <code className="font-mono text-[12px] text-ink">gritqa</code> somewhere on your PATH.
          </p>
          <a
            href="https://github.com/tomiwa-a/gritqa/releases"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink underline decoration-rule-strong underline-offset-2 transition-colors duration-150 hover:decoration-ink"
          >
            <Icon name="github" size={13} />
            GitHub Releases
          </a>
        </div>
      </div>

      <CopyCommand label="Check it landed" command="gritqa --version" />
    </div>
  );
}

const CONFIG = `project: payments-api
path: ~/code/payments-api
branch: main
`;

/**
 * Three states, off the machine rows and nothing else.
 *
 * It used to say "Connected -- payments-api was read 4mo ago", which is two different
 * facts wearing one sentence: an index timestamp is not a liveness signal, and a
 * machine that indexed a project in March is not standing by. The checklist's own tick
 * still comes from the index -- a step should not un-tick when a laptop lid closes --
 * but that belongs to `SetupFlow`, not to this pill, so the prop is gone.
 */
export async function ConnectStep() {
  const [currentProject, machine] = await Promise.all([getCurrentProject(), getMachineStatus()]);
  const connected = machine.connected;
  /* Has any machine ever polled -- which is a different question from whether the
     project has ever been indexed, and the only one this pill can answer honestly. */
  const known = machine.machines[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <CopyCommand label="In your project directory" command="gritqa" />

      <p className="text-[13px] leading-relaxed text-ink-muted">
        The first run reads your routes, handlers, and models, writes a small config file, and links
        this machine to your account. Every run after that only looks at what changed.
      </p>

      <CodeBlock
        filename=".gritqa/config.yaml"
        lang="yaml"
        lineNumbers={false}
        code={CONFIG}
        caption="The config file the CLI writes on its first run: project name, local path, and default branch."
      />

      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px]',
          connected
            ? 'border-pass/25 bg-pass-soft text-pass'
            : known
              ? 'border-warn/25 bg-warn-soft text-warn'
              : 'border-rule bg-app text-ink-muted',
        )}
      >
        <span className="relative flex h-2 w-2">
          {/* Only the live state pings. A pulsing dot reads as activity, and there is
              none in the other two. */}
          {connected && (
            <span className="absolute inset-0 animate-ping rounded-full bg-pass opacity-60" />
          )}
          <span
            className={cn(
              'relative h-2 w-2 rounded-full',
              connected ? 'bg-pass' : known ? 'bg-warn' : 'bg-skip',
            )}
          />
        </span>
        {connected
          ? `Connected — ${known?.hostname ?? currentProject.name}, polling now`
          : known
            ? `Last seen ${known.lastSeenLabel} — start the CLI again to run anything`
            : 'Waiting for your first run on this machine'}
      </div>
    </div>
  );
}

const REVIEW_POINTS = [
  'Every step in order, with the request body it will send',
  'The values carried from one step to the next',
  'Each assertion, and what it is checking for',
];

export function FirstPlanStep() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Nothing runs against your code until you approve it. A plan review shows you:
      </p>

      <ul className="flex flex-col gap-2">
        {REVIEW_POINTS.map((point) => (
          <li key={point} className="flex items-start gap-2 text-[12.5px] text-ink-muted">
            <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
            {point}
          </li>
        ))}
      </ul>

      <Link
        href="/dashboard/queue"
        className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'self-start')}
      >
        Open the review queue
        <Icon name="arrowRight" size={14} />
      </Link>
    </div>
  );
}

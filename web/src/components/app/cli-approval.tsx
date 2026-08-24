import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { approveDeviceAction, denyDeviceAction } from '@/lib/actions/device';
import { cn } from '@/lib/cn';

const SCOPE = [
  'Read this project’s plans, rules, and mock endpoints',
  'Report run results back to this dashboard',
  'Nothing else — the CLI cannot read your other projects',
];

const SCOPE_NEW = ['Add this directory to your dashboard as a project', ...SCOPE];

/**
 * Every state here is a fact read out of the database, not a click remembered in
 * the browser. That is the difference between showing someone their machine was
 * linked and telling them it was.
 */
type CliApprovalProps =
  | { state: 'missing' }
  | { state: 'expired'; code: string }
  | { state: 'denied' }
  | { state: 'linked'; projectName: string | null; collected: boolean }
  | {
      state: 'pending';
      code: string;
      /** `added` means this directory is not a project yet, and approving makes it one. */
      project: { name: string; added: boolean } | null;
      requestedLabel: string;
      hostname: string | null;
      localPath: string | null;
    };

export function CliApproval(props: CliApprovalProps) {
  if (props.state === 'missing') return <MissingCode />;
  if (props.state === 'expired') return <Expired code={props.code} />;
  if (props.state === 'denied') return <Denied />;
  if (props.state === 'linked') {
    return <Linked projectName={props.projectName} collected={props.collected} />;
  }
  return <Pending {...props} />;
}

function Tile({
  tone,
  icon,
}: {
  tone: 'dark' | 'pass' | 'quiet';
  icon: 'terminal' | 'check' | 'close';
}) {
  const tones = {
    dark: 'border-rule-dark bg-surface-dark text-ink-inverse',
    pass: 'border-pass/25 bg-pass-soft text-pass',
    quiet: 'border-rule bg-app text-ink-subtle',
  };
  return (
    <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg border', tones[tone])}>
      <Icon name={icon} size={17} />
    </span>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">{children}</h1>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{children}</p>;
}

function DashboardLink({ label = 'Go to the dashboard' }: { label?: string }) {
  return (
    <Link href="/dashboard" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
      {label}
    </Link>
  );
}

/**
 * Terminals wrap long URLs, so the code arriving without the link it was printed
 * beside is the normal accident rather than a strange one. A plain GET form is
 * enough to recover from it.
 */
function MissingCode() {
  return (
    <>
      <Tile tone="dark" icon="terminal" />
      <Title>Which machine are you approving?</Title>
      <Body>
        Your terminal printed a code alongside this link. Type it in below, or run{' '}
        <span className="font-mono text-ink">gritqa login</span> again to get a fresh one.
      </Body>

      <form method="get" action="/auth/cli" className="mt-5 flex items-start gap-2">
        <Input
          dense
          name="code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="GRIT-4K2P"
          aria-label="Code from your terminal"
          maxLength={12}
          className="nums font-mono tracking-[0.14em] uppercase"
        />
        <Button type="submit" variant="secondary" size="sm" className="shrink-0">
          Continue
        </Button>
      </form>

      <p className="mt-5 border-t border-rule-soft pt-4 text-[12.5px] leading-snug text-ink-muted">
        Never started a sign-in? Then there is nothing here to approve, and you can close this tab.
      </p>
    </>
  );
}

function Expired({ code }: { code: string }) {
  return (
    <>
      <Tile tone="quiet" icon="close" />
      <Title>That request is no longer live</Title>
      <Body>
        Codes last ten minutes, and each one can only be used once. Run{' '}
        <span className="font-mono text-ink">gritqa login</span> again and approve the new code —
        nothing was linked in the meantime.
      </Body>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DashboardLink />
        <Link
          href="/dashboard/setup"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          CLI setup
        </Link>
      </div>

      <p className="mt-5 border-t border-rule-soft pt-4 font-mono text-[11.5px] text-ink-subtle">
        {code}
      </p>
    </>
  );
}

function Denied() {
  return (
    <>
      <Tile tone="quiet" icon="close" />
      <Title>Nothing was linked</Title>
      <Body>
        The request was turned down, and that code is spent — it cannot be approved now, by you or
        anyone holding it. If the machine was yours, run{' '}
        <span className="font-mono text-ink">gritqa login</span> again.
      </Body>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DashboardLink />
      </div>
    </>
  );
}

function Linked({ projectName, collected }: { projectName: string | null; collected: boolean }) {
  return (
    <>
      <Tile tone="pass" icon="check" />
      <Title>This machine is linked</Title>
      <Body>
        {collected
          ? 'Your terminal has picked up the sign-in and is ready to go.'
          : 'Head back to your terminal — it collects the sign-in on its next check.'}
        {projectName ? (
          <>
            {' '}
            It is scoped to <span className="font-mono text-ink">{projectName}</span>.
          </>
        ) : (
          ' It is not scoped to a project yet; indexing one will attach it.'
        )}
      </Body>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DashboardLink />
      </div>
    </>
  );
}

function Pending({
  code,
  project,
  requestedLabel,
  hostname,
  localPath,
}: {
  code: string;
  project: { name: string; added: boolean } | null;
  requestedLabel: string;
  hostname: string | null;
  localPath: string | null;
}) {
  return (
    <>
      <Tile tone="dark" icon="terminal" />
      <Title>
        {project?.added
          ? 'A CLI wants to add a project to your account'
          : 'A CLI wants to link to your account'}
      </Title>
      <Body>
        Only approve this if you started it. Check the code below against the one in your terminal.
      </Body>

      <div className="mt-5 rounded-lg border border-rule bg-app px-4 py-3.5 text-center">
        <p className="text-[11px] font-medium tracking-[0.14em] text-ink-subtle uppercase">
          Code in your terminal
        </p>
        <p className="nums mt-1.5 font-mono text-[22px] font-medium tracking-[0.22em] text-ink">
          {code}
        </p>
      </div>

      <dl className="mt-4 flex flex-col divide-y divide-rule-soft border-y border-rule-soft">
        <Row
          label={project?.added ? 'New project' : 'Project'}
          value={project?.name ?? 'None yet'}
          mono={Boolean(project)}
        />
        {hostname && <Row label="Machine" value={hostname} mono />}
        {localPath && <Row label="Directory" value={localPath} mono />}
        <Row label="Requested" value={requestedLabel} />
      </dl>

      <ul className="mt-4 flex flex-col gap-2">
        {(project?.added ? SCOPE_NEW : SCOPE).map((line) => (
          <li
            key={line}
            className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted"
          >
            <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
            {line}
          </li>
        ))}
      </ul>

      {/* Two forms rather than one with two buttons: each decision is its own action,
          and neither depends on JavaScript having loaded to be the one that fires. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form action={approveDeviceAction}>
          <input type="hidden" name="code" value={code} />
          <Button type="submit" variant="primary" size="sm">
            Approve this machine
          </Button>
        </form>
        <form action={denyDeviceAction}>
          <input type="hidden" name="code" value={code} />
          <Button type="submit" variant="danger" size="sm">
            Deny
          </Button>
        </form>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[12.5px] text-ink-muted">{label}</dt>
      <dd className={cn('truncate text-[12.5px] text-ink', mono && 'font-mono')} title={value}>
        {value}
      </dd>
    </div>
  );
}

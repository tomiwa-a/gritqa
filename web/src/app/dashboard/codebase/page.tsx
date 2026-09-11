import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { EmptyState } from '@/components/app/empty-state';
import { IndexPulse } from '@/components/app/index-pulse';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getCurrentProjectOrNull, getMachineStatus } from '@/lib/data';
import { pendingIndexForScope } from '@/lib/db/jobs';
import { requestReindexAction } from '@/lib/actions/reindex';
import type { IndexProgress } from '@/lib/model';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Codebase · GritQA' };

const RUNGS = [
  { key: 'list', label: 'Listed' },
  { key: 'hash', label: 'Hashed' },
  { key: 'static', label: 'Parsed' },
  { key: 'ai', label: 'Model read' },
  { key: 'link', label: 'Linked' },
] as const;

/**
 * What the CLI found in the project, and how the finding is going.
 *
 * The file and endpoint counts come off the project's mirror rows; the stage
 * list comes off the newest machine's latest pass label, which the CLI
 * overwrites on its poll and heartbeat while a pass runs. The pulse below
 * redraws the page whenever that label moves, so a long model read plays out
 * here instead of in a terminal nobody is watching.
 */
export default async function CodebasePage() {
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="codebase" title="Codebase" />;

  const machine = await getMachineStatus();
  const newest = machine.machines[0] ?? null;
  const progress = newest?.progress ?? null;
  const mark = `${machine.connected}:${JSON.stringify(progress)}`;
  const reindexPending = await pendingIndexForScope();

  return (
    <>
      <Topbar icon="codebase" title="Codebase" />
      <IndexPulse mark={mark} />

      <PageBody>
        <AppPageHeader
          title="What GritQA found in your project"
          description="The routes, handlers, and models the CLI picked up on its last pass — the same map the coverage grid is built from."
        />

        {!newest ? (
          <EmptyState
            icon="codebase"
            title="Nothing has read this project yet"
            description="Run gritqa once in the project folder. It lists every source file, learns the routes, and reports back here."
            action={
              <Link
                href="/onboarding"
                className={cn(buttonVariants({ variant: 'accent', size: 'sm' }))}
              >
                <Icon name="terminal" size={14} />
                Connect this project
              </Link>
            }
          />
        ) : (
          <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel
              title={progress && !progress.complete ? 'Reading now' : 'Last pass'}
              subtitle={
                progress && !progress.complete && progress.file
                  ? progress.file
                  : project.lastIndexedLabel
                    ? `Last read ${project.lastIndexedLabel}`
                    : 'Never read'
              }
              meta={
                newest.connected ? (
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-pass">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-pass opacity-60" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-pass" />
                    </span>
                    live
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-ink-subtle">
                    {newest.hostname ?? 'machine'} · {newest.lastSeenLabel}
                  </span>
                )
              }
            >
              <ol className="flex flex-col">
                {RUNGS.map((rung) => (
                  <Rung
                    key={rung.key}
                    label={rung.label}
                    state={rungState(progress, rung.key)}
                  />
                ))}
              </ol>

              {progress && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-rule-soft px-4 py-3 font-mono text-[11.5px] text-ink-muted">
                  <span>
                    <span className="text-ink">{progress.cached}</span> cached
                  </span>
                  <span>
                    <span className="text-ink">{progress.fresh}</span> fresh
                  </span>
                  {progress.failed > 0 && (
                    <span className="text-fail">{progress.failed} unreadable</span>
                  )}
                </div>
              )}

              {progress && progress.failed > 0 && progress.failures && (
                <ul className="flex flex-col gap-1.5 border-t border-rule-soft px-4 py-3">
                  {progress.failures.map((f) => (
                    <li
                      key={`${f.stage}:${f.file}`}
                      className="flex items-baseline gap-2 text-[12px]"
                    >
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                        {f.stage}
                      </span>
                      <span className="truncate font-mono text-ink">{f.file}</span>
                      <span className="ml-auto shrink-0 text-ink-subtle">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <aside className="flex flex-col gap-4">
              <div className="rounded-xl border border-rule bg-app-panel p-4 shadow-panel">
                <h3 className="text-[13px] font-medium text-ink">Mirror</h3>                <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule-soft bg-rule-soft">
                  {[
                    { value: String(project.fileCount), label: 'files tracked' },
                    { value: String(project.endpointCount), label: 'endpoints found' },
                  ].map((cell) => (
                    <div key={cell.label} className="bg-app-panel px-4 py-3.5">
                      <p className="nums text-[20px] leading-none font-semibold tracking-[-0.02em] text-ink">
                        {cell.value}
                      </p>
                      <p className="mt-1.5 text-[11.5px] text-ink-subtle">{cell.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11.5px] leading-snug text-ink-subtle">
                  Counted from the mirror rows, so the numbers cannot disagree with what they
                  describe. A project the CLI has never indexed reports zero, which is true.
                </p>
                {reindexPending ? (
                  <p className="mt-3 flex items-center gap-1.5 border-t border-rule-soft pt-3 text-[12px] text-ink-muted">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-ink opacity-60" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-ink" />
                    </span>
                    Re-read requested — your machine picks it up on its next poll.
                  </p>
                ) : (
                  <form action={requestReindexAction} className="mt-3 border-t border-rule-soft pt-3">
                    <button
                      type="submit"
                      className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'w-full')}
                    >
                      <Icon name="refresh" size={13} />
                      Re-read now
                    </button>
                  </form>
                )}
              </div>
            </aside>
          </div>
        )}
      </PageBody>
    </>
  );
}

function rungState(
  progress: IndexProgress | null,
  key: (typeof RUNGS)[number]['key'],
): { status: 'done' | 'active' | 'idle'; detail: string } {
  const rung = progress?.stages?.[key];
  if (!rung || rung.total <= 0) {
    // A stage with no workload: done when the pass moved past it, idle before.
    if (!progress) return { status: 'idle', detail: '—' };
    const order: string[] = RUNGS.map((r) => r.key);
    const at = order.indexOf(progress.stage);
    return order.indexOf(key) < at || progress.complete
      ? { status: 'done', detail: '—' }
      : { status: 'idle', detail: '—' };
  }
  if (rung.done >= rung.total) return { status: 'done', detail: `${rung.total}` };
  if (progress && !progress.complete && progress.stage === key)
    return { status: 'active', detail: `${rung.done} of ${rung.total}` };
  return { status: 'idle', detail: `${rung.done} of ${rung.total}` };
}

function Rung({
  label,
  state,
}: {
  label: string;
  state: { status: 'done' | 'active' | 'idle'; detail: string };
}) {
  return (
    <li className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 last:border-0">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
          state.status === 'done' && 'border-pass/40 text-pass',
          state.status === 'active' && 'border-rule-strong text-ink',
          state.status === 'idle' && 'border-rule text-ink-subtle',
        )}
      >
        {state.status === 'done' ? (
          <Icon name="check" size={11} />
        ) : state.status === 'active' ? (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-ink opacity-60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-ink" />
          </span>
        ) : (
          <span className="h-1 w-1 rounded-full bg-current" />
        )}
      </span>
      <span className="text-[13px] text-ink">{label}</span>
      <span className="nums ml-auto font-mono text-[11.5px] text-ink-subtle">{state.detail}</span>
    </li>
  );
}

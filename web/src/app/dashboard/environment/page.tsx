import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { EnvironmentForm } from '@/components/app/environment/environment-form';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { currentScope } from '@/lib/db/scope';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { approvedEnvironment, currentCompose, proposedEnvironment } from '@/lib/db/environment';
import { describe, reconcile } from '@/lib/environment';

/**
 * How this project boots — one screen, one approval.
 *
 * The compose file is a **fact** the CLI pushed up. What GritQA does with each
 * service in it is a **judgement**, and it cannot be recomputed from the codebase:
 * "never boot my tunnel" is intent, written nowhere in the source. So it is
 * answered once by a person here and then persisted, and every boot after that
 * reads the record with no model in the loop.
 *
 * The screen is deliberately not a YAML editor. It replaces one — the answer used
 * to be pasted into `.gritqa/config.yaml` by hand.
 */
export const metadata = { title: 'Environment · GritQA' };

export default async function EnvironmentPage() {
  const scope = await currentScope();
  if (!scope) return <NoProjectGate icon="shield" title="Environment" />;
  const [compose, approved, proposed] = await Promise.all([
    currentCompose(scope.projectId),
    approvedEnvironment(scope.projectId),
    proposedEnvironment(scope.projectId),
  ]);

  return (
    <>
      <Topbar icon="shield" title="Environment" />

      <PageBody>
        <AppPageHeader
          title="How this project boots"
          description="Every service in your compose file gets an answer. GritQA runs its own copy against a database it created — nothing here touches what you have running."
          action={
            approved ? (
              <Badge variant="approved" size="sm">
                <Icon name="check" size={12} />
                Approved
              </Badge>
            ) : proposed ? (
              <Badge variant="review" size="sm">
                Waiting for you
              </Badge>
            ) : undefined
          }
        />

        <div className="mt-5 flex flex-col gap-4">
          {compose ? (
            <Panel
              title={compose.files.join(', ') || 'compose'}
              subtitle={
                approved
                  ? describe(approved.spec)
                  : `${compose.services.length} ${compose.services.length === 1 ? 'service' : 'services'} declared, and nothing boots until each one is answered`
              }
              meta={
                <Badge variant="count" size="sm" className="nums shrink-0">
                  {compose.services.length}
                </Badge>
              }
            >
              {/* Keyed on which decisions the rows came from, so a fresh proposal
                  actually reaches the form: the state inside it is seeded from
                  these rows once, and a remount is the only honest way to reseed. */}
              <Rows
                key={`${approved?.publicId ?? 'none'}:${proposed?.publicId ?? 'none'}`}
                compose={compose}
                approvedServices={approved?.spec.services}
                proposedServices={proposed?.spec.services}
                stale={Boolean(
                  approved && approved.fingerprint && approved.fingerprint !== compose.fingerprint,
                )}
                hasApproved={Boolean(approved)}
                hasProposal={Boolean(proposed)}
              />
            </Panel>
          ) : (
            <Panel title="Nothing has read your compose file yet" subtitle="One command does it">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Run <code className="font-mono text-ink">gritqa</code> in the project once. It reads
                the compose file the way Docker does and sends up what it declares — service names,
                images, commands, ports, and the <em>names</em> of the environment variables each
                one is given. Values stay on your machine.
              </p>
            </Panel>
          )}

          <Panel title="What the five answers mean" subtitle="Pick per service; the boot follows">
            <ul className="flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              <li>
                <strong className="font-medium text-ink">Under test</strong> — requests go here.
                Exactly one, and it is the run&rsquo;s base URL.
              </li>
              <li>
                <strong className="font-medium text-ink">Support</strong> — booted and left alone. A
                database, a cache, a queue the app needs to work.
              </li>
              <li>
                <strong className="font-medium text-ink">Brings the schema up</strong> — a one-shot.
                Run in order, and the app is not up until it finishes.
              </li>
              <li>
                <strong className="font-medium text-ink">Only when a step asks</strong> — left out
                of the boot. A worker on a schedule writes rows no test caused, which would make the
                record of what a test changed a lie.
              </li>
              <li>
                <strong className="font-medium text-ink">Never boot it</strong> — taken out of the
                file before Docker sees it. A tunnel, a mail sender, anything that reaches the
                outside world for real.
              </li>
            </ul>

            <p className="mt-4 flex items-start gap-2 border-t border-rule-soft pt-3 text-[12px] leading-relaxed text-ink-subtle">
              <Icon name="shield" size={13} className="mt-0.5 shrink-0" />
              The copy is cut off from the internet whichever answers you give — outbound
              connections are refused at the network, so a service classified wrongly still cannot
              charge a card or dial home.
            </p>
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

/** Kept separate only so the key above has something to remount. */
function Rows({
  compose,
  approvedServices,
  proposedServices,
  stale,
  hasApproved,
  hasProposal,
}: {
  compose: NonNullable<Awaited<ReturnType<typeof currentCompose>>>;
  approvedServices?: Parameters<typeof reconcile>[1];
  proposedServices?: Parameters<typeof reconcile>[2];
  stale: boolean;
  hasApproved: boolean;
  hasProposal: boolean;
}) {
  const { rows, added, gone } = reconcile(compose.services, approvedServices, proposedServices);
  return (
    <EnvironmentForm
      services={compose.services}
      initial={rows}
      fingerprint={compose.fingerprint}
      added={added}
      gone={gone}
      stale={stale}
      hasApproved={hasApproved}
      hasProposal={hasProposal}
    />
  );
}

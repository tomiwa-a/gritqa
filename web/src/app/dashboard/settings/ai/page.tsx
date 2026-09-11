import Link from 'next/link';
import { SettingsShell } from '@/components/app/settings/settings-shell';
import { SettingRow } from '@/components/app/settings/setting-row';
import { KeyField } from '@/components/app/settings/key-field';
import { DataBoundary } from '@/components/app/settings/data-boundary';
import { Panel } from '@/components/app/panel';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { getUser } from '@/lib/data';
import { OverlayHost } from '@/components/app/overlay-host';
import { type PageParams } from '@/lib/overlay';
import { drafting } from '@/lib/agent';

export const metadata = { title: 'AI drafting · Settings · GritQA' };

/**
 * The badge and the consent paragraph both come from `drafting()` rather than from
 * the stored key, because they stopped being the same fact.
 *
 * A dev machine configured with a service account drafts perfectly well with no key
 * stored, and the page that reads `aiKeyMasked` for its badge would have said
 * "Drafting off" beside a working button -- on the one screen whose entire job is
 * being true about where code goes. The key field below still reads the key,
 * because that is what it is about.
 */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const [user, state] = await Promise.all([getUser(), drafting()]);
  const onDevCredentials = state.on && state.billsTo === 'server';

  return (
    <>
    <SettingsShell
      active="ai"
      title="AI drafting"
      description="A key here lets GritQA write the first draft of a plan. Without one, nothing is generated and nothing is sent anywhere."
      action={
        <Badge variant={!state.on ? 'draft' : onDevCredentials ? 'warn' : 'approved'} size="sm">
          {!state.on ? 'Drafting off' : onDevCredentials ? 'Drafting on · dev' : 'Drafting on'}
        </Badge>
      }
    >
      <Panel title="Your model key" bodyClassName="p-4">
        <KeyField masked={user.aiKeyMasked} />
      </Panel>

      {/* Only ever in development, and worth saying out loud rather than letting a
          green badge imply the key below is doing the work. */}
      {onDevCredentials && (
        <Panel title="Running on this server's own model" bodyClassName="p-4">
          <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
            <Icon name="settings" size={14} className="mt-px shrink-0 text-ink-subtle" />
            Drafting is going through <span className="font-mono text-ink">{state.label}</span> on
            credentials in this machine&rsquo;s environment, so the bill is ours and not yours.
            Store a key above and it takes over immediately.
          </p>
        </Panel>
      )}

      <DataBoundary />

      {/* Not a checkbox. Whatever turns drafting on *is* the consent -- there is no
          second switch that could disagree with it, and a control that looked
          separately savable would be claiming one exists. Which thing that is
          differs, so the sentence names it rather than assuming the key. */}
      <Panel title="Consent" bodyClassName="p-4">
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
          <Icon name="shield" size={14} className="mt-px shrink-0 text-ink-subtle" />
          {!state.on
            ? 'Nothing is sent anywhere. Adding a key is what lets GritQA read your code and send it to a model, and removing it is what stops them.'
            : onDevCredentials
              ? 'When you ask for a draft, GritQA reads whatever parts of your code it needs to answer and sends them to the model named above. Removing the key does not revoke that, because no key is being used — clearing those credentials from the environment is what stops it.'
              : 'When you ask for a draft, GritQA reads whatever parts of your code it needs to answer and sends them to the model above. Removing the key is what revokes that, and it is the only thing that does.'}
        </p>
      </Panel>

      <Panel title="How drafting behaves" bodyClassName="p-0">
        <SettingRow
          label="When drafts appear"
          hint="After a push to the branch you are watching, once the CLI has read the change."
          value="On every push"
        />
        <SettingRow
          label="What a draft can do"
          hint="Nothing, until you approve it. A draft is a proposal sitting in your review queue."
          value="Waits for you"
        />
        <SettingRow
          label="Model"
          hint={
            onDevCredentials
              ? 'This server’s own model, used only until you store a key.'
              : 'Any OpenAI-compatible endpoint. Fixed for the beta while we settle on defaults.'
          }
          value={state.on ? state.label : 'None yet'}
        />
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-app-panel px-4 py-3.5">
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
          <Icon name="plan" size={14} className="mt-px shrink-0 text-ink-subtle" />
          Would rather not involve a model at all? Write plans by hand and GritQA will just run
          them.
        </p>
        <Link
          href="/dashboard/test-plans"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Write a plan
        </Link>
      </div>
    </SettingsShell>
    <OverlayHost params={params} pathname="/dashboard/settings/ai" />
    </>
  );
}

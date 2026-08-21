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

export const metadata = { title: 'AI drafting · Settings · GritQA' };

export default async function AiSettingsPage() {
  const user = await getUser();
  return (
    <SettingsShell
      active="ai"
      title="AI drafting"
      description="A key here lets GritQA write the first draft of a plan. Without one, nothing is generated and nothing is sent anywhere."
      action={
        <Badge variant={user.aiKeyMasked ? 'approved' : 'draft'} size="sm">
          {user.aiKeyMasked ? 'Drafting on' : 'Drafting off'}
        </Badge>
      }
    >
      <Panel title="Your model key" bodyClassName="p-4">
        <KeyField masked={user.aiKeyMasked} />
      </Panel>

      <DataBoundary />

      {/* Not a checkbox. The key is the consent -- there is no second switch that
          could disagree with it, and a control that looked separately savable
          would be claiming one exists. */}
      <Panel title="Consent" bodyClassName="p-4">
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
          <Icon name="shield" size={14} className="mt-px shrink-0 text-ink-subtle" />
          {user.aiKeyMasked
            ? 'When you ask for a draft, GritQA reads whatever parts of your code it needs to answer and sends them to the model above. Removing the key is what revokes that, and it is the only thing that does.'
            : 'Nothing is sent anywhere. Adding a key is what lets GritQA read your code and send it to a model, and removing it is what stops them.'}
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
          label="Model endpoint"
          hint="Any OpenAI-compatible endpoint. Fixed for the beta while we settle on defaults."
          value="OpenAI-compatible"
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
  );
}

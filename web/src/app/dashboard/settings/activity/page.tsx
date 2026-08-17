import { SettingsShell } from '@/components/app/settings/settings-shell';
import { SettingRow } from '@/components/app/settings/setting-row';
import { ActivityLog } from '@/components/app/settings/activity-log';
import { Panel } from '@/components/app/panel';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { auditLog } from '@/lib/mock/data';
import type { AuditTone } from '@/lib/mock/types';

export const metadata = { title: 'Activity · Settings · GritQA' };

type ScopeKey = 'all' | AuditTone;

const SCOPES: { key: ScopeKey; label: string; empty: string }[] = [
  { key: 'all', label: 'Everything', empty: 'Nothing has happened yet.' },
  { key: 'plan', label: 'Plans', empty: 'No plan has been drafted, approved or rejected yet.' },
  { key: 'run', label: 'Runs', empty: 'Nothing has run yet.' },
  { key: 'rule', label: 'Rules', empty: 'No rule or mock has been changed yet.' },
  { key: 'project', label: 'Projects', empty: 'No project has been added or re-read yet.' },
  { key: 'account', label: 'Account', empty: 'No sign-in or key change yet.' },
];

function isScope(value: string | undefined): value is ScopeKey {
  return SCOPES.some((scope) => scope.key === value);
}

function countFor(key: ScopeKey) {
  return key === 'all' ? auditLog.length : auditLog.filter((e) => e.tone === key).length;
}

/* What the log holds, and — just as important on an audit page — what it
   deliberately does not. */
const RECORDED: { label: string; hint: string; value: string }[] = [
  {
    label: 'Every plan decision',
    hint: 'Drafted, edited, approved, rejected or archived — and who did it.',
    value: 'Recorded',
  },
  {
    label: 'Every run',
    hint: 'When it started, which plan it ran, and how it ended.',
    value: 'Recorded',
  },
  {
    label: 'Rule, mock and project changes',
    hint: 'Anything that changes how future plans get drafted.',
    value: 'Recorded',
  },
  {
    label: 'Sign-ins and key changes',
    hint: 'Including the address they came from, so an unfamiliar one stands out.',
    value: 'Recorded',
  },
  {
    label: 'Your source code',
    hint: 'The log names the file that changed at most. It never holds the code itself.',
    value: 'Not recorded',
  },
  {
    label: 'What went over the wire',
    hint: 'Runs happen on your machine, and the requests and responses stay there with them.',
    value: 'Not recorded',
  },
];

export default async function ActivitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const active: ScopeKey = isScope(scope) ? scope : 'all';
  const current = SCOPES.find((s) => s.key === active) ?? SCOPES[0];
  const entries = active === 'all' ? auditLog : auditLog.filter((e) => e.tone === active);

  return (
    <SettingsShell
      active="activity"
      title="Activity"
      description="Everything that has happened in this account: what was drafted, what you approved, and what ran. Entries are only ever added — nothing here can be edited or removed, including by you."
      action={
        <span className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted">
          <Icon name="shield" size={13} className="text-ink-subtle" />
          Append-only
        </span>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented
            className="w-max"
            label="Filter activity by what it touched"
            active={active}
            options={SCOPES.map((s) => ({
              key: s.key,
              label: s.label,
              count: countFor(s.key),
              href:
                s.key === 'all'
                  ? '/dashboard/settings/activity'
                  : `/dashboard/settings/activity?scope=${s.key}`,
            }))}
          />
        </div>

        <p className="nums shrink-0 text-[12.5px] text-ink-subtle">
          {entries.length} of {auditLog.length} entries
        </p>
      </div>

      <Panel
        title={active === 'all' ? 'Recent activity' : `${current.label} activity`}
        subtitle="Newest first, in your local time."
        bodyClassName="p-0"
      >
        {entries.length > 0 ? (
          <ActivityLog entries={entries} />
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="clock" size={18} className="text-ink-subtle" />
            <p className="text-[13px] font-medium text-ink">Nothing to show</p>
            <p className="max-w-[38ch] text-[12.5px] leading-snug text-ink-muted">
              {current.empty} It will appear here the moment it does.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="What ends up in here" bodyClassName="p-0">
        {RECORDED.map((row) => (
          <SettingRow key={row.label} label={row.label} hint={row.hint} value={row.value} />
        ))}
      </Panel>

      <Panel title="Keeping it" bodyClassName="p-0">
        <SettingRow
          label="How long it is kept"
          hint="The log is the record of who approved what, so it outlives the plans and runs it describes."
          value="For the life of the account"
        />
        <SettingRow
          label="Take a copy"
          hint="The whole log as JSON, for your own records or a review you have to hand in."
          control={
            <Button variant="secondary" size="sm">
              Export as JSON
            </Button>
          }
        />
      </Panel>
    </SettingsShell>
  );
}

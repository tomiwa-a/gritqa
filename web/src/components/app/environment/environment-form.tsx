'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { approveEnvironmentAction, proposeEnvironmentAction } from '@/lib/actions/environment';
import { ROLES, SQL_DRIVERS, check } from '@/lib/environment';
import type { ComposeService, EnvironmentRow, RoleChoice } from '@/lib/environment';

/**
 * One row per service, and every one of them has to be answered.
 *
 * That is the whole mechanism. A list that names four services out of five is
 * worse than no list, because the fifth is then started by a default nobody
 * chose -- which on one project on this machine would have published a sandbox to
 * the public internet through a live tunnel token. So the screen refuses to
 * submit an unanswered row, and `check()` on the server refuses again.
 *
 * **Dropdowns, not text.** The other half of this product has a plan on disk
 * right now that cannot run because a hand edit left `{{roomTypeName Updated}}`
 * in it. A dropdown cannot be malformed, which is why the agent's answer arrives
 * here as pre-filled *choices* rather than as YAML to paste.
 *
 * Two sibling forms, per the key-field pattern: asking the agent to read the file
 * and approving what is on the screen are different writes, and nesting them
 * would send every row along with the request to think.
 *
 * The visible controls are nameless and driven from state; each row emits six
 * hidden inputs instead. The action reads `svc`/`role`/`why`/`port`/`store`/`login`
 * as parallel `getAll()` arrays lined up by index, so a row that renders one field
 * conditionally must still submit a value for it -- hidden inputs from state make
 * that true by construction rather than by remembering to.
 */
export function EnvironmentForm({
  services,
  initial,
  fingerprint,
  added,
  gone,
  stale,
  hasApproved,
  hasProposal,
}: {
  services: ComposeService[];
  initial: EnvironmentRow[];
  fingerprint: string;
  added: string[];
  gone: string[];
  stale: boolean;
  hasApproved: boolean;
  hasProposal: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [approveState, approve] = useActionState(approveEnvironmentAction, null);
  const [proposeState, propose] = useActionState(proposeEnvironmentAction, null);

  const edit = (i: number, patch: Partial<EnvironmentRow>) =>
    setRows((current) => current.map((r, at) => (at === i ? { ...r, ...patch } : r)));

  const wrong = check(rows, services);
  const answered = rows.filter((r) => r.role).length;

  return (
    <div className="flex flex-col gap-4">
      {gone.length > 0 && (
        <Note tone="warn">
          {list(gone)} {gone.length === 1 ? 'is' : 'are'} no longer in this compose file, so{' '}
          {gone.length === 1 ? 'that answer' : 'those answers'} will be dropped when you save.
        </Note>
      )}
      {added.length > 0 && (
        <Note tone="info">
          {list(added)} {added.length === 1 ? 'is' : 'are'} new since you last approved this. Every
          other answer below is the one you already gave.
        </Note>
      )}
      {stale && added.length === 0 && (
        <Note tone="info">
          The compose file has changed since this was approved, and none of these answers moved.
          Saving again records it against the file as it is now.
        </Note>
      )}

      <form action={propose} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="fingerprint" value={fingerprint} />
        <ProposeButton hasApproved={hasApproved} />
        <p className="min-w-0 flex-1 basis-[280px] text-[12px] leading-snug text-ink-subtle">
          It reads the file only — image, command, ports and the names of the environment variables
          each service is given. It fills in what nobody has answered and never touches a choice you
          made.
        </p>
      </form>

      {proposeState && <Result state={proposeState} />}

      <form action={approve} className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-lg border border-rule">
          {rows.map((row, i) => (
            <ServiceRow
              key={row.service}
              row={row}
              service={services.find((s) => s.name === row.service)}
              first={i === 0}
              onChange={(patch) => edit(i, patch)}
            />
          ))}
        </div>

        {rows.map((row) => (
          <Hidden key={row.service} row={row} />
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="nums text-[12px] text-ink-subtle">
            {answered === rows.length
              ? `All ${rows.length} answered`
              : `${answered} of ${rows.length} answered`}
          </p>
          <ApproveButton hasApproved={hasApproved} hasProposal={hasProposal} />
        </div>

        {approveState ? (
          <Result state={approveState} />
        ) : wrong ? (
          <Note tone="warn">{wrong}</Note>
        ) : (
          <Note tone="quiet">
            Nothing boots on a proposal. Once you save this, every run reads what is here and no
            model is asked again until the file changes.
          </Note>
        )}
      </form>
    </div>
  );
}

/**
 * One service. Which fields appear follows from the role: a port is asked for
 * where a port is used, and `why` is required on `never` because the service is
 * cut out of the file altogether and nothing else records the reason.
 */
function ServiceRow({
  row,
  service,
  first,
  onChange,
}: {
  row: EnvironmentRow;
  service: ComposeService | undefined;
  first: boolean;
  onChange: (patch: Partial<EnvironmentRow>) => void;
}) {
  const { pending } = useFormStatus();
  const measured = row.measure === 'sql';
  const wantsPort = row.role === 'tested' || measured;

  return (
    <div
      className={`flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-start ${first ? '' : 'border-t border-rule-soft'} ${row.role ? '' : 'bg-warn-soft/25'}`}
    >
      <div className="min-w-0 flex-1 basis-[220px] pt-1.5">
        <p className="flex items-center gap-2 font-mono text-[13px] text-ink">
          <span className="truncate">{row.service}</span>
          {row.fresh && (
            <Badge variant="notice" size="xs" className="shrink-0 px-1.5">
              new
            </Badge>
          )}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-subtle">
          {service?.image || (service?.build ? `built from ${service.build}` : '—')}
        </p>
      </div>

      <div className="flex min-w-0 flex-[2] basis-[320px] flex-col gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <span className="min-w-0 flex-1 basis-[200px]">
            <Select
              dense
              aria-label={`What GritQA does with ${row.service}`}
              value={row.role}
              disabled={pending}
              invalid={!row.role}
              onChange={(e) => onChange(role(e.target.value as RoleChoice))}
            >
              <option value="">Pick one —</option>
              {ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </Select>
          </span>

          {row.role && row.role !== 'tested' && (
            <span className="min-w-0 basis-[180px]">
              <Select
                dense
                aria-label={`How ${row.service} is read for the ledger`}
                value={row.measure === 'sql' ? (row.driver ?? '') : ''}
                disabled={pending}
                onChange={(e) =>
                  onChange(
                    e.target.value
                      ? { measure: 'sql', driver: e.target.value }
                      : { measure: '', driver: '' },
                  )
                }
              >
                <option value="">Not measured</option>
                {SQL_DRIVERS.map((d) => (
                  <option key={d} value={d}>
                    Measured over {d}
                  </option>
                ))}
              </Select>
            </span>
          )}

          {wantsPort && (
            <span className="basis-[110px]">
              <Input
                dense
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                aria-label={`The port inside ${row.service}`}
                placeholder="Port"
                value={row.port ?? ''}
                disabled={pending}
                invalid={!row.port}
                onChange={(e) => onChange({ port: Number.parseInt(e.target.value, 10) || undefined })}
              />
            </span>
          )}
        </div>

        {row.role && (
          <Input
            dense
            aria-label={`Why ${row.service} is ${row.role === 'never' ? 'never booted' : 'set this way'}`}
            placeholder={
              row.role === 'never'
                ? 'Why it is never booted — required'
                : 'A note, if it helps the next person (optional)'
            }
            value={row.why ?? ''}
            disabled={pending}
            invalid={row.role === 'never' && !row.why?.trim()}
            onChange={(e) => onChange({ why: e.target.value })}
          />
        )}

        {row.role && (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            {ROLES.find((r) => r.role === row.role)?.blurb}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The service under test is measured on its files rather than on rows, so becoming
 * it clears any store answer. Leaving one behind is how a spec ends up carrying an
 * answer to a question nobody is asking any more -- and `check()` would refuse it.
 */
function role(next: RoleChoice): Partial<EnvironmentRow> {
  if (next === 'tested') return { role: next, measure: '', driver: '', login: undefined };
  return { role: next };
}

/** The six values the action reads, in the order it reads them. */
function Hidden({ row }: { row: EnvironmentRow }) {
  return (
    <>
      <input type="hidden" name="svc" value={row.service} />
      <input type="hidden" name="role" value={row.role} />
      <input type="hidden" name="why" value={row.why ?? ''} />
      <input type="hidden" name="port" value={row.port ?? ''} />
      <input type="hidden" name="store" value={row.measure === 'sql' ? (row.driver ?? '') : ''} />
      <input type="hidden" name="login" value={row.login ? JSON.stringify(row.login) : ''} />
    </>
  );
}

function ApproveButton({
  hasApproved,
  hasProposal,
}: {
  hasApproved: boolean;
  hasProposal: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? 'Saving…' : hasApproved ? 'Save changes' : hasProposal ? 'Approve this' : 'Save'}
    </Button>
  );
}

function ProposeButton({ hasApproved }: { hasApproved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="secondary" size="sm" type="submit" disabled={pending}>
      <Icon name="sparkle" size={14} />
      {pending ? 'Reading the file…' : hasApproved ? 'Fill in what is new' : 'Let the agent work it out'}
    </Button>
  );
}

function Result({ state }: { state: { error: string } | { ok: string } }) {
  return 'error' in state ? (
    <Note tone="warn">{state.error}</Note>
  ) : (
    <Note tone="ok">{state.ok}</Note>
  );
}

function Note({
  tone,
  children,
}: {
  tone: 'warn' | 'ok' | 'info' | 'quiet';
  children: React.ReactNode;
}) {
  const look = {
    warn: { icon: 'alert', className: 'text-warn' },
    ok: { icon: 'check', className: 'text-pass' },
    info: { icon: 'sparkle', className: 'text-info' },
    quiet: { icon: 'shield', className: 'text-ink-subtle' },
  } as const;
  const { icon, className } = look[tone];

  return (
    <p className={`flex items-start gap-2 text-[12px] leading-relaxed ${className}`}>
      <Icon name={icon} size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

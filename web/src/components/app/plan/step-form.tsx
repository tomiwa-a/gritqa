'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StepBadge } from '@/components/ui/step-badge';
import {
  ASSERTIONS_BY_KIND,
  METHODS,
  OPERATORS,
  SOURCES,
  stepInconsistency,
} from '@/lib/agent/plan-schema';
import { stepKindOf } from '@/lib/plan';
import type { Method } from '@/components/ui/method-badge';
import type {
  AssertionOperator,
  AssertionType,
  PlanAssertion,
  PlanExtraction,
  PlanStepSpec,
  StepKind,
} from '@/lib/model';
import {
  Area,
  Choice,
  EditorModal,
  Field,
  Group,
  List,
  MONO,
  PairRows,
  Select,
} from './editor-parts';
import { cn } from '@/lib/cn';

const KINDS: readonly { key: StepKind; label: string; hint: string }[] = [
  { key: 'http', label: 'Request', hint: 'Call the API' },
  { key: 'sql', label: 'Statement', hint: 'Read or write a row' },
  { key: 'shell', label: 'Command', hint: 'Run something in the container' },
];

/**
 * What goes in `target` for a check that has only one thing to read. `rowCount` and the
 * two shell checks each name their own channel, so the runner ignores the target -- but
 * the schema requires one, and leaving it for somebody to fill in makes the form refuse
 * a check that was already unambiguous.
 */
const CHANNEL: Partial<Record<AssertionType, string>> = {
  status: 'status',
  responseTime: 'responseTime',
  rowCount: 'rowCount',
  exitCode: 'exitCode',
  stdoutContains: 'stdout',
};

const TARGET_HINT: Partial<Record<AssertionType, string>> = {
  bodyField: 'data.id',
  header: 'Content-Type',
  valueEquals: 'rows[0].total',
};

const WORDS: Record<AssertionType, string> = {
  status: 'the status code',
  bodyField: 'a field in the body',
  header: 'a response header',
  responseTime: 'how long it took',
  rowCount: 'how many rows came back',
  valueEquals: 'a value in the result',
  exitCode: 'the exit code',
  stdoutContains: 'what it printed',
};

/**
 * A typed expected value out of a typed string. `status equals "200"` and
 * `status equals 200` are not the same JSON, and the runner compares against what the
 * response actually holds -- so the form stores the number when the text is one, and
 * leaves anything ambiguous (`0012`, `{{total}}`) as written.
 */
function typed(text: string): string | number | boolean | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return String(Number(trimmed)) === trimmed ? Number(trimmed) : text;
}

function shown(value: string | number | boolean | undefined): string {
  return value === undefined ? '' : String(value);
}

function fill(record: Record<string, string> | undefined): Record<string, string> | undefined {
  return record && Object.keys(record).length > 0 ? record : undefined;
}

export function blankStep(id: string, kind: StepKind): PlanStepSpec {
  return {
    id,
    name: '',
    description: '',
    dependsOn: [],
    kind,
    request: kind === 'http' ? { method: 'GET', url: '' } : undefined,
    action:
      kind === 'sql'
        ? { statement: '', target: 'verify' }
        : kind === 'shell'
          ? { command: '' }
          : undefined,
    extract: [],
    assertions: [],
    onFailure: 'abort',
  };
}

/**
 * One step, as a form.
 *
 * The step it is editing is a copy: nothing reaches the working copy until Save, so
 * closing the box leaves the plan exactly as it was. `stepInconsistency` is the same
 * function the wire path holds a drafted step to, which is the point -- a step somebody
 * builds here cannot be one the runner would refuse to load.
 */
export function StepForm({
  step,
  eyebrow,
  others,
  onSave,
  onClose,
}: {
  step: PlanStepSpec;
  eyebrow: string;
  others: { id: string; name: string }[];
  onSave: (next: PlanStepSpec) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PlanStepSpec>(step);
  const [bodyText, setBodyText] = useState(() =>
    step.request?.body ? JSON.stringify(step.request.body, null, 2) : '',
  );
  const [problem, setProblem] = useState<string | null>(null);

  const kind = stepKindOf(draft);
  const set = (patch: Partial<PlanStepSpec>) => setDraft((d) => ({ ...d, ...patch }));
  const checks = ASSERTIONS_BY_KIND[kind];

  const changeKind = (next: StepKind) =>
    setDraft((d) => ({
      ...d,
      kind: next,
      request: next === 'http' ? (d.request ?? { method: 'GET', url: '' }) : undefined,
      action:
        next === 'sql'
          ? { statement: d.action?.statement ?? '', target: d.action?.target ?? 'verify' }
          : next === 'shell'
            ? { command: d.action?.command ?? '' }
            : undefined,
      /* A check reads something this kind does not have any more, so it goes rather than
         becoming a check that can never pass. The receipt says what left. */
      assertions: d.assertions.filter((a) =>
        (ASSERTIONS_BY_KIND[next] as readonly AssertionType[]).includes(a.type),
      ),
    }));

  const save = () => {
    let body: Record<string, unknown> | undefined;
    if (kind === 'http' && bodyText.trim()) {
      try {
        const parsed: unknown = JSON.parse(bodyText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setProblem('The body has to be a JSON object.');
          return;
        }
        body = parsed as Record<string, unknown>;
      } catch {
        setProblem('The body is not valid JSON yet.');
        return;
      }
    }

    const next: PlanStepSpec = {
      ...draft,
      id: draft.id.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      request:
        kind === 'http'
          ? {
              method: draft.request?.method ?? 'GET',
              url: (draft.request?.url ?? '').trim(),
              headers: fill(draft.request?.headers),
              query: fill(draft.request?.query),
              body,
            }
          : undefined,
      action:
        kind === 'sql'
          ? {
              statement: (draft.action?.statement ?? '').trim(),
              target: draft.action?.target ?? 'verify',
            }
          : kind === 'shell'
            ? { command: (draft.action?.command ?? '').trim() }
            : undefined,
    };

    if (!next.id) {
      setProblem('The step needs an id — later steps refer to it by that.');
      return;
    }
    if (!next.name) {
      setProblem('The step needs a name.');
      return;
    }
    const bad = stepInconsistency(next);
    if (bad) {
      setProblem(`This step ${bad}.`);
      return;
    }
    onSave(next);
  };

  return (
    <EditorModal
      label="step editor"
      eyebrow={eyebrow}
      title={draft.name || 'A new step'}
      wide
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {problem && <p className="min-w-0 flex-1 text-[11.5px] text-punch-red">{problem}</p>}
          <div className={cn('flex gap-2', !problem && 'ml-auto')}>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              Keep this step
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Group label="What this step does" hint="A statement runs against GritQA's own copy of your database; a command runs inside its container.">
          <Choice label="Step type" value={kind} onChange={changeKind} options={KINDS} />
        </Group>

        <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
          <Field label="id" hint="Referred to as a dependency.">
            <Input
              dense
              value={draft.id}
              onChange={(e) => set({ id: e.target.value })}
              placeholder="s1"
              className={MONO}
            />
          </Field>
          <Field label="Name">
            <Input
              dense
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Sign the guest in"
            />
          </Field>
        </div>

        <Field label="Why it is here" hint="One line. It is what a reviewer reads first.">
          <Area
            rows={2}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Proves the token the rest of the plan spends is real."
          />
        </Field>

        {kind === 'http' && (
          <>
            <Group label="Request" hint="The url is relative to the plan's base url. {{name}} reads a variable.">
              <div className="flex min-w-0 gap-1.5">
                <Select
                  value={draft.request?.method ?? 'GET'}
                  onChange={(method: Method) =>
                    set({ request: { ...(draft.request ?? { url: '' }), method } })
                  }
                  options={METHODS}
                  className="w-[6.5rem] shrink-0"
                />
                <Input
                  dense
                  value={draft.request?.url ?? ''}
                  onChange={(e) =>
                    set({
                      request: { ...(draft.request ?? { method: 'GET' }), url: e.target.value },
                    })
                  }
                  placeholder="/guests/{{guestId}}"
                  className={cn(MONO, 'flex-1')}
                />
              </div>
            </Group>

            <Group label="Headers">
              <PairRows
                value={draft.request?.headers ?? {}}
                onChange={(headers) =>
                  set({ request: { ...(draft.request ?? { method: 'GET', url: '' }), headers } })
                }
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer {{authToken}}"
                add="Add a header"
                empty="None."
              />
            </Group>

            <Group label="Query">
              <PairRows
                value={draft.request?.query ?? {}}
                onChange={(query) =>
                  set({ request: { ...(draft.request ?? { method: 'GET', url: '' }), query } })
                }
                keyPlaceholder="guest_id"
                valuePlaceholder="{{guestId}}"
                add="Add a query parameter"
                empty="None."
              />
            </Group>

            <Field label="Body" hint="JSON, or empty for a request that sends none.">
              <Area
                rows={5}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder={'{\n  "address": "12 Marina Road"\n}'}
                className={MONO}
              />
            </Field>
          </>
        )}

        {kind === 'sql' && (
          <>
            <Group
              label="What it is for"
              hint="A setup statement is executed to build state. A verify statement is queried, and its rows are the evidence the checks below read."
            >
              <Choice
                label="What the statement is for"
                value={draft.action?.target ?? 'verify'}
                onChange={(target: 'setup' | 'verify') =>
                  set({ action: { ...(draft.action ?? {}), target } })
                }
                options={[
                  { key: 'verify', label: 'Verify', hint: 'Read a row back' },
                  { key: 'setup', label: 'Set up', hint: 'Write a row directly' },
                ]}
              />
            </Group>

            <Field label="Statement">
              <Area
                rows={4}
                value={draft.action?.statement ?? ''}
                onChange={(e) => set({ action: { ...(draft.action ?? {}), statement: e.target.value } })}
                placeholder="SELECT count(*) AS n FROM bookings WHERE guest_id = '{{guestId}}'"
                className={MONO}
              />
            </Field>
          </>
        )}

        {kind === 'shell' && (
          <Field label="Command" hint="Runs inside GritQA's container, with the project mounted.">
            <Area
              rows={3}
              value={draft.action?.command ?? ''}
              onChange={(e) => set({ action: { command: e.target.value } })}
              placeholder="php artisan queue:work --once"
              className={MONO}
            />
          </Field>
        )}

        <Group
          label="Checks"
          hint="What this step claims. The runner grades against these and nothing else — a repair is never allowed to move one."
        >
          <List<PlanAssertion>
            items={draft.assertions}
            onChange={(assertions) => set({ assertions })}
            blank={() => ({
              type: checks[0],
              operator: 'equals',
              target: CHANNEL[checks[0]] ?? '',
            })}
            add="Add a check"
            empty="Nothing is being checked yet, so this step can only fail by erroring."
            render={(check: PlanAssertion, setCheck) => (
              <div className="flex min-w-0 flex-wrap gap-1.5">
                <Select
                  value={check.type}
                  onChange={(type: AssertionType) =>
                    setCheck({
                      ...check,
                      type,
                      /* Carry a target the reader typed; replace one the form filled in. */
                      target:
                        !check.target || check.target === CHANNEL[check.type]
                          ? (CHANNEL[type] ?? '')
                          : check.target,
                    })
                  }
                  options={checks}
                  label={(t) => WORDS[t]}
                  className="flex-[1.4]"
                />
                <Select
                  value={check.operator}
                  onChange={(operator: AssertionOperator) => setCheck({ ...check, operator })}
                  options={OPERATORS}
                  className="w-[6.5rem]"
                />
                {!CHANNEL[check.type] && (
                  <Input
                    dense
                    value={check.target}
                    onChange={(e) => setCheck({ ...check, target: e.target.value })}
                    placeholder={TARGET_HINT[check.type] ?? 'where to look'}
                    className={cn(MONO, 'flex-1')}
                  />
                )}
                {check.operator !== 'exists' && (
                  <Input
                    dense
                    value={shown(check.expected)}
                    onChange={(e) => setCheck({ ...check, expected: typed(e.target.value) })}
                    placeholder="expected"
                    className={cn(MONO, 'flex-1')}
                  />
                )}
              </div>
            )}
          />
        </Group>

        <Group
          label="Values it hands to later steps"
          hint="A name later steps read as {{name}}."
        >
          <List<PlanExtraction>
            items={draft.extract}
            onChange={(extract) => set({ extract })}
            blank={() => ({
              name: '',
              path: '',
              source: kind === 'sql' ? 'result' : kind === 'shell' ? 'stdout' : 'body',
            })}
            add="Extract a value"
            empty="None."
            render={(value: PlanExtraction, setValue) => (
              <div className="flex min-w-0 flex-wrap gap-1.5">
                <Input
                  dense
                  value={value.name}
                  onChange={(e) => setValue({ ...value, name: e.target.value })}
                  placeholder="authToken"
                  className={cn(MONO, 'flex-1')}
                />
                <Input
                  dense
                  value={value.path}
                  onChange={(e) => setValue({ ...value, path: e.target.value })}
                  placeholder="$.data.token"
                  className={cn(MONO, 'flex-[1.4]')}
                />
                <Select
                  value={value.source}
                  onChange={(source: PlanExtraction['source']) => setValue({ ...value, source })}
                  options={SOURCES}
                  className="w-[6rem]"
                />
              </div>
            )}
          />
        </Group>

        <Group label="If it fails">
          <Choice
            label="If it fails"
            value={draft.onFailure}
            onChange={(onFailure: 'abort' | 'continue') => set({ onFailure })}
            options={[
              { key: 'abort', label: 'Stop the run', hint: 'Everything after it is skipped' },
              { key: 'continue', label: 'Carry on', hint: 'Independent steps still run' },
            ]}
          />

          <div className="mt-1 flex flex-wrap items-end gap-2">
            <Field label="Attempts">
              <Input
                dense
                type="number"
                min={1}
                value={draft.retry?.maxAttempts ?? 1}
                onChange={(e) => {
                  const maxAttempts = Math.max(1, Number(e.target.value) || 1);
                  set({
                    retry:
                      maxAttempts > 1
                        ? { maxAttempts, delayMs: draft.retry?.delayMs ?? 250 }
                        : undefined,
                  });
                }}
                className={cn(MONO, 'w-[5rem]')}
              />
            </Field>
            {draft.retry && (
              <Field label="Milliseconds apart">
                <Input
                  dense
                  type="number"
                  min={0}
                  value={draft.retry.delayMs}
                  onChange={(e) =>
                    set({
                      retry: {
                        maxAttempts: draft.retry?.maxAttempts ?? 2,
                        delayMs: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className={cn(MONO, 'w-[6rem]')}
                />
              </Field>
            )}
          </div>
        </Group>

        {others.length > 0 && (
          <Group
            label="Runs after"
            hint="This step is skipped if one of these never got there."
          >
            <div className="flex flex-wrap gap-1.5">
              {others.map((other) => {
                const on = draft.dependsOn.includes(other.id);
                return (
                  <button
                    key={other.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        dependsOn: on
                          ? draft.dependsOn.filter((d) => d !== other.id)
                          : [...draft.dependsOn, other.id],
                      })
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors duration-150',
                      on
                        ? 'border-ink bg-app-active text-ink'
                        : 'border-rule bg-app-panel text-ink-muted hover:border-rule-strong hover:text-ink',
                    )}
                  >
                    <span className="font-mono text-[11px] text-ink-subtle">{other.id}</span>
                    <span className="max-w-[10rem] truncate">{other.name || 'unnamed'}</span>
                  </button>
                );
              })}
            </div>
          </Group>
        )}

        <div className="flex items-center gap-2 rounded-lg border border-rule-soft bg-app px-3 py-2">
          <StepBadge kind={kind} method={draft.request?.method} />
          <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted">
            {kind === 'http'
              ? draft.request?.url || 'no url yet'
              : kind === 'sql'
                ? draft.action?.statement || 'no statement yet'
                : draft.action?.command || 'no command yet'}
          </p>
          <span className="nums shrink-0 text-[11px] text-ink-subtle">
            {draft.assertions.length} check{draft.assertions.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </EditorModal>
  );
}

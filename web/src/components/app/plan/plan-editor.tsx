'use client';

import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { StepBadge } from '@/components/ui/step-badge';
import { METHODS } from '@/lib/agent/plan-schema';
import {
  createPlanByHandAction,
  savePlanEditAction,
  type BuildState,
  type EditState,
} from '@/lib/actions/edit';
import { changesBetween, planProblems, type EditedPlan } from '@/lib/plan-edit';
import { stepHeadline, stepKindOf } from '@/lib/plan';
import type { Method } from '@/components/ui/method-badge';
import type { Endpoint, PlanChange, PlanStepSpec } from '@/lib/model';
import { Area, Field, Group, IconButton, List, MONO, PairRows, Select } from './editor-parts';
import { StepForm, blankStep } from './step-form';
import { cn } from '@/lib/cn';

/**
 * A plan, edited by hand.
 *
 * The working copy lives here and nowhere else until Save: the server holds the version
 * that was approved, and this holds what somebody is in the middle of thinking. That is
 * why nothing in this tree is a link -- a navigation would take the unsaved copy with it.
 *
 * The gate is `planProblems`, the same reading of the plan the action runs before it
 * writes. Shown while you type rather than on submit, because the point of a form over a
 * JSON file is finding out now.
 */

type Target = { mode: 'edit'; publicId: string; version: number } | { mode: 'new' };

/**
 * A working copy survives a reload, and only for the version it was taken from: the key
 * carries the version, so an edit begun against v3 is simply not offered once the plan is
 * v4. That is the same answer the server gives a stale save, reached without asking
 * anybody to read a warning.
 */
function stashKey(target: Target, version: number): string {
  return target.mode === 'edit' ? `gritqa.edit.${target.publicId}.v${version}` : 'gritqa.edit.new';
}

/**
 * The stash is read through `useSyncExternalStore` because it exists only in the browser:
 * the server renders what the server knows, and React swaps in the held copy after
 * hydration rather than warning about a mismatch. The snapshot is the stored text rather
 * than a parsed plan, because a snapshot has to be the same value twice running and every
 * parse would be a new object.
 */
const INERT = () => () => {};

function heldText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function heldPlan(raw: string | null): EditedPlan | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EditedPlan;
  } catch {
    return null;
  }
}

function nextId(steps: PlanStepSpec[]): string {
  const taken = new Set(steps.map((s) => s.id));
  for (let n = 1; ; n += 1) {
    if (!taken.has(`s${n}`)) return `s${n}`;
  }
}

export function PlanEditor({
  target,
  initial,
  baseUrl = '',
}: {
  target: Target;
  initial: EditedPlan;
  baseUrl?: string;
}) {
  const [edited, setEdited] = useState<EditedPlan | null>(null);
  const [base, setBase] = useState(baseUrl);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const version = target.mode === 'edit' ? target.version : 0;
  const key = stashKey(target, version);
  const prefix = target.mode === 'edit' ? `gritqa.edit.${target.publicId}.v` : '';

  const raw = useSyncExternalStore(
    INERT,
    () => heldText(key),
    () => null,
  );
  const held = useMemo(() => heldPlan(raw), [raw]);
  const plan = edited ?? held ?? initial;

  const changes = useMemo(() => changesBetween(initial, plan), [initial, plan]);
  const problems = useMemo(() => planProblems(plan), [plan]);

  /* The stash exists only while something is unsaved: a save revalidates the page, the
     new `initial` matches, and the key goes rather than lingering as a stale offer. The
     sweep is what keeps one key per plan as versions land. */
  useEffect(() => {
    try {
      if (changes.length === 0) localStorage.removeItem(key);
      else if (edited) localStorage.setItem(key, JSON.stringify(edited));

      if (!prefix) return;
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const other = localStorage.key(i);
        if (other && other !== key && other.startsWith(prefix)) localStorage.removeItem(other);
      }
    } catch {
      /* A browser with storage off still edits fine; it just does not survive a reload. */
    }
  }, [key, prefix, edited, changes.length]);

  const set = (patch: Partial<EditedPlan>) => setEdited({ ...plan, ...patch });
  const step = open === null ? null : (plan.steps[open] ?? blankStep(nextId(plan.steps), 'http'));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= plan.steps.length) return;
    const steps = [...plan.steps];
    const [lifted] = steps.splice(from, 1);
    steps.splice(to, 0, lifted);
    set({ steps });
  };

  const saveStep = (next: PlanStepSpec) => {
    const at = open !== null && open < plan.steps.length ? open : -1;
    set({
      steps: at < 0 ? [...plan.steps, next] : plan.steps.map((s, i) => (i === at ? next : s)),
    });
    setOpen(null);
  };

  /* A step's dependencies are ids, so removing one leaves the steps that waited on it
     pointing at nothing. Cleared here rather than reported as a problem the reader did
     not cause. */
  const removeStep = (index: number) => {
    const gone = plan.steps[index].id;
    set({
      steps: plan.steps
        .filter((_, i) => i !== index)
        .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== gone) })),
    });
  };

  const blocked = problems.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {held && (
        <p className="rounded-lg border border-rule bg-app-panel px-3 py-2 text-[12px] text-ink-muted">
          Picked up where you left off. Nothing is saved until you write a version.
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-xl border border-rule bg-app-panel p-4">
        <Field label="Name">
          <Input
            dense
            value={plan.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="A guest books a room and pays for it"
          />
        </Field>

        <Field label="What it proves" hint="One sentence. It is the plan's whole claim.">
          <Area
            rows={2}
            value={plan.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="A signed-in guest can book an available room and the booking lands in the database."
          />
        </Field>

        {target.mode === 'new' && (
          <Field label="Base url" hint="Every step's url is relative to this.">
            <Input
              dense
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="http://localhost:8080"
              className={MONO}
            />
          </Field>
        )}

        <Group
          label="Values the plan seeds"
          hint="Read as {{name}} anywhere in a step. A step can produce more as it runs."
        >
          <PairRows
            value={plan.variables}
            onChange={(variables) => set({ variables })}
            keyPlaceholder="testEmail"
            valuePlaceholder="qa@example.com"
            add="Seed a value"
            empty="None — every value comes from the steps."
          />
        </Group>

        <Group label="Endpoints it covers" hint="What the coverage map reads.">
          <List<Endpoint>
            items={plan.covers}
            onChange={(covers) => set({ covers })}
            blank={() => ({ method: 'GET', path: '' })}
            add="Add an endpoint"
            empty="None declared."
            render={(endpoint: Endpoint, setEndpoint) => (
              <div className="flex min-w-0 gap-1.5">
                <Select
                  value={endpoint.method}
                  onChange={(method: Method) => setEndpoint({ ...endpoint, method })}
                  options={METHODS}
                  className="w-[6.5rem] shrink-0"
                />
                <Input
                  dense
                  value={endpoint.path}
                  onChange={(e) => setEndpoint({ ...endpoint, path: e.target.value })}
                  placeholder="/bookings/{id}"
                  className={cn(MONO, 'flex-1')}
                />
              </div>
            )}
          />
        </Group>

        <Field
          label="What it takes on faith"
          hint="One per line. What the plan assumes rather than proves."
        >
          <Area
            rows={3}
            value={plan.assumptions.join('\n')}
            onChange={(e) =>
              set({
                assumptions: e.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'The seeded guest can sign in.\nRoom 101 is free.'}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-ink">
            Steps <span className="nums text-ink-subtle">{plan.steps.length}</span>
          </h3>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setOpen(plan.steps.length)}
            className="gap-1.5"
          >
            <Icon name="plus" size={12} />
            Add a step
          </Button>
        </div>

        {plan.steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-rule-strong px-3 py-6 text-center text-[12px] text-ink-subtle">
            No steps yet. A plan needs at least one.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {plan.steps.map((s, i) => {
              const wrong = problems.filter((p) => p.stepId === s.id);
              return (
                <li
                  key={`${s.id}-${i}`}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border bg-app-panel px-2.5 py-2',
                    wrong.length > 0 ? 'border-fail/40' : 'border-rule',
                  )}
                >
                  <span className="nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule-strong text-[11px] text-ink-muted">
                    {i + 1}
                  </span>
                  <StepBadge kind={stepKindOf(s)} method={s.request?.method} />
                  <button
                    type="button"
                    onClick={() => setOpen(i)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[12.5px] text-ink">{s.name || 'An unnamed step'}</p>
                    <p className="truncate font-mono text-[11px] text-ink-subtle">
                      {stepHeadline(s)}
                    </p>
                    {wrong.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-fail">{wrong[0].problem}</p>
                    )}
                  </button>
                  <span className="nums shrink-0 text-[11px] text-ink-subtle">
                    {s.assertions.length}
                  </span>
                  <div className="flex shrink-0 items-center">
                    <IconButton
                      label="Move up"
                      icon="arrowUp"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    />
                    <IconButton
                      label="Move down"
                      icon="arrowDown"
                      disabled={i === plan.steps.length - 1}
                      onClick={() => move(i, i + 1)}
                    />
                    <IconButton label="Edit" icon="pencil" onClick={() => setOpen(i)} />
                    <IconButton
                      label="Remove"
                      icon="trash"
                      tone="fail"
                      onClick={() => removeStep(i)}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {problems.length > 0 && (
        <section className="rounded-xl border border-fail/30 bg-fail-soft px-3.5 py-3">
          <p className="text-[12px] font-semibold text-ink">
            {problems.length === 1
              ? 'One thing to fix before this can be saved'
              : `${problems.length} things to fix before this can be saved`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {problems.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] text-ink-muted">
                <span className="shrink-0 font-mono text-[11px] text-ink-subtle">
                  {p.stepId ?? '—'}
                </span>
                <span className="min-w-0">{p.problem}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-rule bg-app-panel p-4">
        {target.mode === 'edit' && <Receipt changes={changes} />}

        <Field
          label={target.mode === 'edit' ? 'Why you changed it' : 'Why you wrote it'}
          hint="Kept with the version, so the next reader knows what you were after."
        >
          <Area
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              target.mode === 'edit'
                ? 'The wallet check was reading the wrong field.'
                : 'Covers the booking flow the drafts keep missing.'
            }
          />
        </Field>

        {target.mode === 'edit' ? (
          <SaveEdit
            publicId={target.publicId}
            version={target.version}
            plan={plan}
            note={note}
            blocked={blocked}
            unchanged={changes.length === 0}
          />
        ) : (
          <SaveNew
            plan={plan}
            note={note}
            baseUrl={base}
            blocked={blocked}
            onSubmit={() => {
              /* The create redirects, so this component never comes back to clear it. */
              try {
                localStorage.removeItem(key);
              } catch {
                /* Nothing to clear. */
              }
            }}
          />
        )}
      </section>

      {step && (
        <StepForm
          key={open}
          step={step}
          eyebrow={
            open !== null && open < plan.steps.length ? `step ${open + 1}` : 'a step of its own'
          }
          others={plan.steps
            .filter((_, i) => i !== open)
            .map((s) => ({ id: s.id, name: s.name }))}
          onSave={saveStep}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** What the version will say it changed — read off the diff, not written by anyone. */
function Receipt({ changes }: { changes: PlanChange[] }) {
  const [all, setAll] = useState(false);
  if (changes.length === 0) {
    return (
      <p className="text-[12px] text-ink-subtle">
        Nothing has changed yet, so there is no version to write.
      </p>
    );
  }
  const shown = all ? changes : changes.slice(0, 5);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold text-ink">
        {changes.length === 1 ? 'One change' : `${changes.length} changes`}
      </p>
      <ul className="flex flex-col gap-1">
        {shown.map((change, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] text-ink-muted">
            <span className="min-w-0 truncate text-ink">{change.stepName}</span>
            <span className="min-w-0">{change.detail}</span>
          </li>
        ))}
      </ul>
      {changes.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="self-start text-[11.5px] text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink"
        >
          and {changes.length - shown.length} more
        </button>
      )}
    </div>
  );
}

/* Two bars rather than one over a union: the actions carry different state types, and a
   single hook typed across both would accept a state neither action can read. */

function SaveEdit({
  publicId,
  version,
  plan,
  note,
  blocked,
  unchanged,
}: {
  publicId: string;
  version: number;
  plan: EditedPlan;
  note: string;
  blocked: boolean;
  unchanged: boolean;
}) {
  const [state, submit, pending] = useActionState<EditState, FormData>(savePlanEditAction, null);

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="publicId" value={publicId} />
      <input type="hidden" name="fromVersion" value={version} />
      <input type="hidden" name="note" value={note} />
      <input type="hidden" name="plan" value={JSON.stringify(plan)} />

      <Button type="submit" size="sm" disabled={pending || blocked || unchanged}>
        {pending ? 'Saving…' : `Save as v${version + 1}`}
      </Button>
      <Status state={state} pending={pending} blocked={blocked} />
    </form>
  );
}

function SaveNew({
  plan,
  note,
  baseUrl,
  blocked,
  onSubmit,
}: {
  plan: EditedPlan;
  note: string;
  baseUrl: string;
  blocked: boolean;
  onSubmit: () => void;
}) {
  const [state, submit, pending] = useActionState<BuildState, FormData>(
    createPlanByHandAction,
    null,
  );

  return (
    <form action={submit} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="baseUrl" value={baseUrl} />
      <input type="hidden" name="note" value={note} />
      <input type="hidden" name="plan" value={JSON.stringify(plan)} />

      <Button type="submit" size="sm" disabled={pending || blocked || !baseUrl.trim()}>
        {pending ? 'Writing…' : 'Write the plan'}
      </Button>
      <Status state={state} pending={pending} blocked={blocked} />
    </form>
  );
}

function Status({
  state,
  pending,
  blocked,
}: {
  state: EditState | BuildState;
  pending: boolean;
  blocked: boolean;
}) {
  if (pending) return null;
  if (state && 'error' in state) {
    return <p className="min-w-0 flex-1 text-[11.5px] text-fail">{state.error}</p>;
  }
  if (state && 'ok' in state) {
    return (
      <p className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
        Saved as v{state.version}. {state.summary}
      </p>
    );
  }
  if (blocked) {
    return (
      <p className="min-w-0 flex-1 text-[11.5px] text-ink-subtle">
        Fix what is listed above and this saves.
      </p>
    );
  }
  return null;
}

'use server';

import { revalidatePath } from 'next/cache';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { requireScope } from '@/lib/db/scope';
import {
  approveEnvironment,
  approvedEnvironment,
  currentCompose,
  proposeEnvironment,
} from '@/lib/db/environment';
import { proposeClassification } from '@/lib/agent/environment';
import { check, describe, reconcile, toSpec } from '@/lib/environment';
import { SQL_DRIVERS } from '@/lib/environment';
import type { EnvironmentLogin, EnvironmentRow } from '@/lib/environment';

/**
 * The two writes behind the environment screen.
 *
 * Both re-derive the project from the session rather than accepting one, like every
 * other action here: the form is trusted for what it says about services, never for
 * whose services they are.
 *
 * The asymmetry between them is the point. `approve` is the only thing that produces
 * a row a boot will read, and it is a person's click. `propose` writes a draft that
 * nothing boots on. So the agent runs on an explicit press rather than inside the
 * route the CLI pushes to -- a model call in the boot path would make `gritqa` sit
 * waiting on Vertex before it could tell the developer anything.
 */

export type EnvironmentFormState = { error: string } | { ok: string } | null;

const PATH = '/dashboard/environment';

function revalidate() {
  revalidatePath(PATH);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/settings/activity');
}

/**
 * Rows out of the form.
 *
 * Every row emits every field, so the parallel `getAll` arrays line up by index and
 * nothing has to encode a service name into a form key. A service name is whatever
 * compose allows, and building `role.my-service.1` keys was one escaping bug waiting
 * to happen.
 */
function rowsOf(formData: FormData): EnvironmentRow[] {
  const services = formData.getAll('svc').map(String);
  const roles = formData.getAll('role').map(String);
  const whys = formData.getAll('why').map(String);
  const ports = formData.getAll('port').map(String);
  const stores = formData.getAll('store').map(String);
  const logins = formData.getAll('login').map(String);

  return services.map((service, i) => {
    const out: EnvironmentRow = { service: service.trim(), role: '' };
    const role = roles[i] ?? '';
    if (role === 'tested' || role === 'support' || role === 'schema' || role === 'on_demand' || role === 'never') {
      out.role = role;
    }
    const why = (whys[i] ?? '').trim().slice(0, 500);
    if (why) out.why = why;

    const port = Number.parseInt(ports[i] ?? '', 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) out.port = port;

    // One dropdown says both things, because "measured over SQL" and "which SQL" are
    // never separate questions -- a store is read with a client or it is not read.
    const store = stores[i] ?? '';
    if (SQL_DRIVERS.some((d) => d === store)) {
      out.measure = 'sql';
      out.driver = store;
    }

    const login = parseLogin(logins[i]);
    if (login) out.login = login;
    return out;
  });
}

/**
 * The login rides through the form as JSON rather than as three more inputs.
 *
 * It is a reference and not a secret -- `$MYSQL_ROOT_PASSWORD` names a variable the
 * CLI reads at boot on the developer's own machine -- but it is also not something a
 * person picks from a list, so it round-trips as whatever was proposed or approved
 * last. Bounded because it arrives from a browser.
 */
function parseLogin(raw: string | undefined): EnvironmentLogin | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const input = parsed as Record<string, unknown>;
    const out: EnvironmentLogin = {};
    for (const key of ['user', 'password', 'name'] as const) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 255);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * A person picked, and this is what a boot reads from here on.
 *
 * `check` runs before the write and not after, because an environment that refuses to
 * boot is not something to store and then discover: the CLI validates the same shape
 * against the real compose file, and the developer would find out at `gritqa` time
 * with no screen in front of them.
 */
export async function approveEnvironmentAction(
  _previous: EnvironmentFormState,
  formData: FormData,
): Promise<EnvironmentFormState> {
  const scope = await requireScope();
  const compose = await currentCompose(scope.projectId);
  if (!compose) {
    return { error: 'Nothing has read this project’s compose file yet. Run gritqa in it once.' };
  }

  const rows = rowsOf(formData);
  const wrong = check(rows, compose.services);
  if (wrong) return { error: wrong };

  const previous = await approvedEnvironment(scope.projectId);
  const spec = toSpec(rows, { writable: previous?.spec.writable });
  const saved = await approveEnvironment(
    scope.projectId,
    scope.userId,
    spec,
    compose.fingerprint,
  );

  await record({
    userId: scope.userId,
    action: previous ? 'environment.updated' : 'environment.approved',
    entityType: 'project_environments',
    // The spec itself, both sides. This is the audit entry that answers "who said the
    // tunnel should never boot, and when did that change" -- and the screen only ever
    // shows the current answer.
    previous: previous ? { spec: previous.spec } : undefined,
    values: { spec: saved.spec, fingerprint: saved.fingerprint },
    ip: await clientIp(),
  });

  revalidate();
  return { ok: `Saved — ${describe(saved.spec)}.` };
}

/**
 * Ask the agent. It fills in the rows nobody has answered and never touches one
 * somebody has: `reconcile` is what holds that, so adding Redis six weeks from now
 * shows one new row rather than five to re-check.
 */
export async function proposeEnvironmentAction(
  _previous: EnvironmentFormState,
  formData: FormData,
): Promise<EnvironmentFormState> {
  const scope = await requireScope();
  const compose = await currentCompose(scope.projectId);
  if (!compose) {
    return { error: 'Nothing has read this project’s compose file yet. Run gritqa in it once.' };
  }

  // The CLI pushes the file on every boot, so it can change while this screen is open.
  // Proposing against the file the reader is looking at, or not at all: a proposal for a
  // different set of services would arrive as pre-filled rows with nothing marking them.
  const seen = formData.get('fingerprint');
  if (typeof seen === 'string' && seen && seen !== compose.fingerprint) {
    return { error: 'Your compose file has changed since this page loaded. Reload it first.' };
  }

  const approved = await approvedEnvironment(scope.projectId);
  const held = approved?.spec.services ?? [];
  const open = compose.services.filter((s) => !held.some((c) => c.service === s.name));
  if (!open.length) {
    return { ok: 'Every service in this file already has an answer you gave.' };
  }

  let proposal;
  try {
    proposal = await proposeClassification(compose.services);
  } catch (error) {
    return { error: reason(error) };
  }

  // Only the unanswered ones, whatever the model returned. It is handed the whole file
  // because a service is classified by what sits around it, but a proposal that
  // overwrote a decision would make the approval worthless.
  const { rows } = reconcile(compose.services, held, proposal.services);
  const spec = toSpec(rows, { author: 'agent', why: proposal.note });
  const saved = await proposeEnvironment(scope.projectId, spec, compose.fingerprint);

  await record({
    userId: scope.userId,
    action: 'environment.proposed',
    entityType: 'project_environments',
    values: { spec: saved.spec, model: proposal.model, services: open.map((s) => s.name) },
    ip: await clientIp(),
  });

  revalidate();
  return {
    ok: `${proposal.model} read the file and filled in ${open.length === 1 ? open[0].name : `${open.length} services`}. Nothing boots until you approve it.`,
  };
}

/** A model failure the developer can act on, rather than a stack trace. */
function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('NO_MODEL_KEY')) {
    return 'No model key is set for this account, so nothing can read the file for you. Settings → AI, or pick the roles yourself.';
  }
  return `The agent could not work it out: ${text.slice(0, 300)}`;
}

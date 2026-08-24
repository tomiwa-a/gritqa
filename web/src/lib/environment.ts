/**
 * How a project boots, as the CLI writes it down.
 *
 * These types mirror `cli/internal/sandbox`'s `Compose` and `Environment` field for
 * field, snake_case tags included, because they are the wire format between the two
 * halves and not a view model. The CLI owns the shape and re-validates it against
 * the real compose file before any boot -- so `check` below is here to stop somebody
 * approving something that will be refused, not to be the authority on what is
 * valid. Two opinions about validity is how the two halves drift.
 *
 * The split that matters: a compose file is a **fact**, and what GritQA does with
 * each service in it is a **judgement**. The judgement cannot be recomputed from the
 * codebase -- "never boot my tunnel" is intent, written nowhere in the source --
 * which is why it is approved once by a person and then persisted.
 */

/** One published port, as compose resolved it. `published` is a string: it can be a range. */
export type ComposePort = {
  container: number;
  published?: string;
  protocol?: string;
};

/**
 * One service, trimmed to what a person needs to recognise it and what the agent
 * needs to guess at what it is for.
 *
 * `env` holds the variable **names** and never their values. Compose resolves
 * `${MYSQL_ROOT_PASSWORD}` to the real password, and a compose file can also just
 * write one in literally -- either way a value here would be a copy of somebody's
 * secret sitting in our database. The names are all that is needed: a login refers
 * to a variable as `$MYSQL_ROOT_PASSWORD` and the CLI reads the value at boot, on
 * the developer's own machine.
 */
export type ComposeService = {
  name: string;
  image?: string;
  build?: string;
  command?: string[];
  ports?: ComposePort[];
  profiles?: string[];
  env?: string[];
};

/** The compose file as the CLI read it. */
export type ComposeFacts = {
  projectName: string;
  fingerprint: string;
  files: string[];
  services: ComposeService[];
};

/**
 * What GritQA does with one service. There are five, and every service in the file
 * gets one -- a list that names four services out of five is worse than no list,
 * because the fifth is then started by a default nobody chose.
 */
export type EnvironmentRole = 'tested' | 'support' | 'schema' | 'on_demand' | 'never';

/** `''` is a row nobody has answered yet. It exists for the screen; it never ships. */
export type RoleChoice = EnvironmentRole | '';

export const ROLES: { role: EnvironmentRole; label: string; blurb: string }[] = [
  {
    role: 'tested',
    label: 'Under test',
    blurb: 'Requests go here. Exactly one service, and it is the run’s base URL.',
  },
  {
    role: 'support',
    label: 'Support',
    blurb: 'Booted and left alone — a database, a cache, a queue the app needs to work.',
  },
  {
    role: 'schema',
    label: 'Brings the schema up',
    blurb: 'A one-shot. Run in order, and the app is not up until it finishes.',
  },
  {
    role: 'on_demand',
    label: 'Only when a step asks',
    blurb: 'Left out of the boot. A worker on a schedule writes rows no test caused.',
  },
  {
    role: 'never',
    label: 'Never boot it',
    blurb: 'Taken out of the file before Docker sees it. Say why — nothing else records it.',
  },
];

/** How a service's state is read for the ledger. Separate from the role, not a kind of one. */
export type EnvironmentMeasure = '' | 'sql';

/** Nothing said is denied: the safe answer is the one you get by not thinking about it. */
export type EnvironmentEgress = 'deny' | 'allow';

/**
 * A login by reference. A field starting with `$` names a variable on the
 * datastore service, and the CLI reads its value at boot -- so a password that
 * arrived from someone's `.env` never travels to whoever wrote this down.
 */
export type EnvironmentLogin = {
  user?: string;
  password?: string;
  name?: string;
};

export type ServiceClassification = {
  service: string;
  role: EnvironmentRole;
  /** Required on `never`, optional elsewhere. */
  why?: string;
  /** The container port: the one the app serves on, or the one its datastore listens on. */
  port?: number;
  measure?: EnvironmentMeasure;
  driver?: string;
  login?: EnvironmentLogin;
  /** A schema step's command. Empty means the service's own. */
  run?: string[];
};

export type SchemaStep = { service: string; run?: string[] };

/**
 * The `sandbox.Environment` the CLI decodes, verbatim.
 *
 * The fields above `services` are the older shape, from before roles existed, and
 * they are what a boot actually reads. Once `services` is non-empty they are
 * **derived** from it by `normalize` -- so the two can never disagree, and an
 * environment written before any of this keeps booting exactly as it did.
 */
export type EnvironmentSpec = {
  app: string;
  port: number;
  database?: string;
  db_port?: number;
  driver?: string;
  login?: EnvironmentLogin;
  schema?: SchemaStep[];
  writable?: string[];
  services?: ServiceClassification[];
  egress?: EnvironmentEgress;
  author: string;
  fingerprint?: string;
  why?: string;
};

/** Drivers this build has a client compiled in for, so it can take its own readings. */
export const SQL_DRIVERS = ['mysql', 'postgres'] as const;

/**
 * Makes the older fields views onto the classification. A copy, and idempotent --
 * the Go side does exactly this on decode, and doing it here too means what sits in
 * Postgres is already self-consistent rather than only becoming so once a CLI reads it.
 */
export function normalize(spec: EnvironmentSpec): EnvironmentSpec {
  const services = spec.services ?? [];
  if (services.length === 0) return spec;

  const out: EnvironmentSpec = { ...spec, app: '', port: 0 };
  delete out.database;
  delete out.db_port;
  delete out.driver;
  delete out.login;
  delete out.schema;

  const schema: SchemaStep[] = [];
  for (const s of services) {
    if (s.role === 'tested') {
      out.app = s.service;
      out.port = s.port ?? 0;
    }
    if (s.role === 'schema') schema.push(s.run?.length ? { service: s.service, run: s.run } : { service: s.service });
    // The first sql-measured store is the one the older fields can hold. A second is
    // not lost -- it is still in `services` -- but one `database` field cannot say it.
    if (s.measure === 'sql' && !out.database) {
      out.database = s.service;
      out.db_port = s.port;
      out.driver = s.driver;
      if (s.login) out.login = s.login;
    }
  }
  if (schema.length) out.schema = schema;
  return out;
}

/**
 * The web's echo of the CLI's completeness check, in the words a person reading the
 * screen needs. Returns the first thing wrong, or null.
 *
 * Every service classified or the boot refuses. That is the whole mechanism, and it
 * is what makes a tunnel impossible to *miss* rather than something you have to know
 * to look for.
 */
export function check(rows: EnvironmentRow[], services: ComposeService[]): string | null {
  const declared = new Set(services.map((s) => s.name));
  const seen = new Set<string>();
  let tested = '';

  const missing = services.filter((s) => !rows.some((r) => r.service === s.name && r.role));
  if (missing.length) {
    return `${and(missing.map((s) => s.name))} ${missing.length === 1 ? 'has' : 'have'} no answer yet. Every service needs one — anything left blank is something Docker starts because nothing said otherwise.`;
  }

  for (const row of rows) {
    if (!row.role) continue;
    if (!declared.has(row.service)) {
      return `${row.service} is not a service in this compose file any more.`;
    }
    if (seen.has(row.service)) return `${row.service} is answered twice.`;
    seen.add(row.service);

    if (row.role === 'tested') {
      if (tested) {
        return `${tested} and ${row.service} are both under test, and a run has one base URL.`;
      }
      tested = row.service;
      if (!port(row.port)) return `${row.service} is under test — say which port inside it serves HTTP.`;
    }
    if (row.role === 'never' && !row.why?.trim()) {
      return `Say why ${row.service} is never booted. It is taken out of the file, so nothing else records the reason.`;
    }
    if (row.measure === 'sql') {
      if (row.role === 'tested') {
        return `${row.service} is the service under test, so it is measured on its files rather than on rows.`;
      }
      if (!row.driver?.trim()) return `${row.service} is watched over SQL — say what it speaks.`;
      if (!port(row.port)) return `${row.service} is watched over SQL — say which port it listens on.`;
    }
  }
  if (!tested) {
    return 'Nothing is under test. One service answers the requests a run makes, and that is the one.';
  }
  return null;
}

const port = (n: number | undefined) => typeof n === 'number' && n >= 1 && n <= 65535;

/** A row on the screen: a classification whose role may not have been picked yet. */
export type EnvironmentRow = Omit<ServiceClassification, 'role'> & {
  role: RoleChoice;
  /** True when this service has appeared since the last approval. */
  fresh?: boolean;
};

export type Reconciled = {
  /** One row per declared service, in the order compose declares them. */
  rows: EnvironmentRow[];
  /** Services that appeared since the approval — the only rows a re-derivation may fill. */
  added: string[];
  /** Decisions whose service is no longer declared. Dropped, and said out loud. */
  gone: string[];
};

/**
 * Re-derivation is a **diff, never a replace**.
 *
 * When Redis shows up in the compose file six weeks from now and the agent reads it
 * again, the screen has to show one new row and leave every existing choice exactly
 * as it was. A proposal that overwrote answers a person already gave would make the
 * approval worthless -- you would have to re-check five rows to find the one that
 * changed. So an existing decision always wins, and a proposal only ever fills a
 * service nobody has answered.
 */
export function reconcile(
  services: ComposeService[],
  approved: ServiceClassification[] = [],
  proposed: ServiceClassification[] = [],
): Reconciled {
  const held = new Map(approved.map((c) => [c.service, c]));
  const guess = new Map(proposed.map((c) => [c.service, c]));

  const rows = services.map<EnvironmentRow>((s) => {
    const mine = held.get(s.name);
    if (mine) return { ...mine };
    const theirs = guess.get(s.name);
    if (theirs) return { ...theirs, fresh: held.size > 0 };
    return { service: s.name, role: '', fresh: held.size > 0 };
  });

  const declared = new Set(services.map((s) => s.name));
  return {
    rows,
    added: rows.filter((r) => r.fresh).map((r) => r.service),
    gone: approved.filter((c) => !declared.has(c.service)).map((c) => c.service),
  };
}

/** The rows, as a spec ready to store. Blank roles are dropped; `check` is what rejects them. */
export function toSpec(rows: EnvironmentRow[], base: Partial<EnvironmentSpec> = {}): EnvironmentSpec {
  const services = rows
    .filter((r): r is EnvironmentRow & { role: EnvironmentRole } => r.role !== '')
    .map<ServiceClassification>((r) => {
      const out: ServiceClassification = { service: r.service, role: r.role };
      if (r.why?.trim()) out.why = r.why.trim();
      if (r.port) out.port = r.port;
      if (r.measure) out.measure = r.measure;
      if (r.driver?.trim()) out.driver = r.driver.trim();
      if (r.login && (r.login.user || r.login.password || r.login.name)) out.login = r.login;
      if (r.run?.length) out.run = r.run;
      return out;
    });

  return normalize({
    app: '',
    port: 0,
    egress: 'deny',
    author: 'approved',
    ...base,
    services,
  });
}

/** One line for a list or a header. */
export function describe(spec: EnvironmentSpec): string {
  const services = spec.services ?? [];
  const parts: string[] = [];
  if (spec.app) parts.push(`${spec.app} on ${spec.port}`);
  if (spec.database) parts.push(`${spec.database} over ${spec.driver}`);
  const refused = services.filter((s) => s.role === 'never').map((s) => s.service);
  if (refused.length) parts.push(`refusing ${and(refused)}`);
  const held = services.filter((s) => s.role === 'on_demand').map((s) => s.service);
  if (held.length) parts.push(`holding back ${and(held)}`);
  if (services.length && spec.egress !== 'allow') parts.push('no internet');
  return parts.join(', ');
}

function and(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

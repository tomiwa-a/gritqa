import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './model';
import { ROLES, SQL_DRIVERS } from '@/lib/environment';
import type { ComposeService, ServiceClassification } from '@/lib/environment';

/**
 * Working out what each service in a compose file is for.
 *
 * One model call, no tools. That is deliberate and it is not a shortcut: a compose
 * file is a *declaration*, and the whole question here — is this the app, is this a
 * datastore, would booting this reach the internet — is answered by the image name,
 * the command and the ports. Reading the project's source would cost thirty tool
 * calls to tell you that `cloudflared` is a tunnel.
 *
 * What comes back is a **proposal**. Nothing boots on it. It fills the dropdowns on
 * the environment screen, a person changes what the agent got wrong, and their
 * answer is the thing that gets stored — because the one field here that cannot be
 * derived from anything is intent. "Never boot my tunnel" is not written in the
 * codebase, and no amount of reading it produces that answer.
 */

const roleEnum = z.enum(['tested', 'support', 'schema', 'on_demand', 'never']);

const classification = z.object({
  service: z.string().describe('the service name, exactly as the compose file declares it'),
  role: roleEnum,
  why: z
    .string()
    .describe('one short sentence. Required for never; otherwise a note or an empty string'),
  port: z
    .number()
    .int()
    .describe('the container port this serves on, or 0 when that is not a question about it'),
  measure: z
    .enum(['', 'sql'])
    .describe('sql when this is a SQL datastore whose rows should be counted, otherwise empty'),
  driver: z.string().describe(`${SQL_DRIVERS.join(' or ')} when measure is sql, otherwise empty`),
  login: z
    .object({
      user: z.string(),
      password: z.string(),
      name: z.string(),
    })
    .describe(
      'how to connect when measure is sql, each field either a $VARIABLE_NAME from this ' +
        "service's environment or a literal that was in the compose file. Empty strings otherwise",
    ),
});

const proposal = z.object({
  services: z.array(classification),
  note: z.string().describe('one or two sentences on anything a person should look at closely'),
});

/**
 * The instruction, and the two things it exists to get right.
 *
 * A service left unclassified is the failure this whole screen was built for: a
 * `docker compose up` with nothing said boots everything, and on one real project
 * that would have started a Cloudflare tunnel holding a live token and published
 * GritQA's copy of the app to the public internet. So the prompt asks for every
 * service, and both halves — the CLI and the screen — refuse an answer that skips one.
 *
 * The second is that the agent is asked to be *suspicious* rather than tidy. A
 * service it cannot place is `never` with a reason, not `support` because supporting
 * is the harmless-sounding word.
 */
const RULES = `
You are reading one project's Docker Compose file and working out what GritQA should
do with each service when it boots a private copy of the project to test it.

The copy is a copy: its own containers, its own volumes, its own database, no access
to the internet. Nothing you say here touches what the developer runs themselves.

Every service in the file gets exactly one role. A file where you answered four
services out of five is worse than no answer at all, because the fifth is then
started by a default nobody chose.

${ROLES.map((r) => `- ${r.role}: ${r.blurb}`).join('\n')}

Exactly one service is "tested", and it is the one that answers HTTP requests — the
API, the web app. Give its container port.

"never" is for a service that would do something outside this machine, or something
irreversible, if it were started: a tunnel that publishes the app to the public
internet, a mail sender, a payment worker, an agent that reports to a third party.
Read the image name and the command. If a service would open a connection to the
outside world, it is "never" and you say why in one sentence.

"on_demand" is for a worker on a schedule. It is left out of the boot and started
only when a test step asks for it, because a job firing every two minutes writes rows
no test caused and makes the record of what a test changed a lie.

"schema" is for a one-shot that prepares the database and exits: a migration, a
seeder. It is not a long-running service.

Where you cannot tell what a service is for, say "never" and say that you could not
tell. A service that stays off is a test that cannot run; a service that should have
stayed off is a real thing happening in the real world.

Mark a SQL datastore with measure "sql" and name the driver, so a run can report what
moved in it. Only ${SQL_DRIVERS.join(' and ')} can be read that way; another datastore
is "support" with measure empty. Never mark the tested service as sql.

For a login, prefer the variable name: write "$MYSQL_ROOT_PASSWORD" rather than a
password, even when you can see the password. The variable is read on the developer's
own machine at boot. Never write a secret you can see into any other field.
`.trim();

export type EnvironmentProposal = {
  services: ServiceClassification[];
  note: string;
  /** Which model wrote it, for the line under the screen's button. */
  model: string;
};

export async function proposeClassification(
  services: ComposeService[],
): Promise<EnvironmentProposal> {
  const { model, label } = await resolveModel();

  const out = await generateObject({
    model,
    schema: proposal,
    system: RULES,
    prompt: [
      'This is the compose file, as compose itself resolved it. `env` is the names of',
      'the environment variables each service is given — the values are not here and',
      'you do not need them.',
      '',
      JSON.stringify({ services }, null, 2),
      '',
      `Classify all ${services.length}: ${services.map((s) => s.name).join(', ')}.`,
    ].join('\n'),
  });

  return { services: out.object.services.map(tidy), note: out.object.note.trim(), model: label };
}

/**
 * The model answers every field because a schema with optionals gets fewer of them
 * filled in; this drops the ones it answered with a blank. Same job as the screen's
 * own `toSpec`, one step earlier.
 */
function tidy(raw: z.infer<typeof classification>): ServiceClassification {
  const out: ServiceClassification = { service: raw.service.trim(), role: raw.role };
  if (raw.why?.trim()) out.why = raw.why.trim();
  if (raw.port > 0 && raw.port <= 65535) out.port = raw.port;

  // Only on a store it can actually read, and never on the service under test: a
  // measure GritQA has no client for would be a boot that refuses over a guess.
  const driver = raw.driver?.trim().toLowerCase() ?? '';
  const readable = SQL_DRIVERS.some((d) => d === driver);
  if (raw.measure === 'sql' && raw.role !== 'tested' && readable) {
    out.measure = 'sql';
    out.driver = driver;
    const login = {
      ...(raw.login?.user?.trim() ? { user: raw.login.user.trim() } : {}),
      ...(raw.login?.password?.trim() ? { password: raw.login.password.trim() } : {}),
      ...(raw.login?.name?.trim() ? { name: raw.login.name.trim() } : {}),
    };
    if (Object.keys(login).length) out.login = login;
  }
  return out;
}

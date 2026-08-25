import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { decryptSecret } from '@/lib/crypto';
import { readSession } from '@/lib/session';
import type { Session } from '@/lib/session';
export type { Session } from '@/lib/session';

/**
 * Which model drafts, and on whose account.
 *
 * The dashboard has been making a promise about this for months -- "GritQA drafts
 * plans with your key, on your account, so you keep the bill and the choice of
 * model" -- so the developer's own key is not a fallback here, it is the answer.
 * Everything else is scaffolding for a machine that has not been given one.
 *
 * Deciding and building are separated on purpose. `choose()` says what would be
 * used and costs nothing; `resolveModel()` builds it. The AI settings page needs
 * the first without the second, and a badge that reported drafting by trying to
 * construct a provider would be doing real work to render a word.
 */

/** Fixed for the beta, which is what the settings page already tells the developer. */
const MODEL_VAR = 'GRITQA_MODEL';
const BASE_URL_VAR = 'GRITQA_MODEL_BASE_URL';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * `gemini-2.5-flash` through **Vertex**, not AI Studio: the free Generative
 * Language tier is 20 requests a day, which one afternoon of drafting exhausts
 * before lunch.
 */
const DEV_MODEL = 'gemini-2.5-flash';

export class NoModelKeyError extends Error {
  readonly code = 'NO_MODEL_KEY';

  constructor() {
    super('NO_MODEL_KEY: no model key is set for this account.');
    this.name = 'NoModelKeyError';
  }
}

/**
 * A service account, pasted once into `.env.local` and then left alone.
 *
 * This is the answer to re-authenticating every morning. ADC works and needs
 * nothing stored, but it is a login: `gcloud auth application-default login`
 * again whenever the machine forgets. A service account key is a credential
 * google-auth-library mints and refreshes access tokens *from*, so the thing in
 * the env file never expires and nothing has to be re-pasted.
 *
 * The tradeoff is that a long-lived private key now sits in a file, which is why
 * it sits in `.env.local` -- gitignored at both levels of this repo -- and why the
 * only thing that ever reads it is this function.
 */
type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const email = process.env.GCP_CLIENT_EMAIL?.trim();
  const key = process.env.GCP_PRIVATE_KEY?.trim();
  if (!email || !key) return null;

  /*
   * The one line that makes this painless however it was pasted.
   *
   * A PEM is multi-line and a `.env` value is one line, so the key arrives with
   * its newlines written as the two characters `\` and `n`. dotenv only unescapes
   * those inside double quotes, and an unquoted paste therefore reaches OpenSSL as
   * a single line of base64 with literal backslashes in it -- which fails as
   * `error:1E08010C:DECODER routines::unsupported`, an error message that says
   * nothing about the actual problem. Normalising here means quoted, unquoted and
   * already-real-newlines all work.
   */
  return { client_email: email, private_key: key.replace(/\\n/g, '\n').replace(/^"|"$/g, '') };
}

/** What would be used, decided without building anything. */
type Choice =
  | { on: 'user'; key: string; name: string; baseURL: string }
  | {
      on: 'vertex';
      name: string;
      project: string;
      location: string;
      credentials: ServiceAccount | null;
    };

export type ResolvedModel = {
  model: LanguageModel;
  /** For the transcript. Never the key, or any part of it. */
  label: string;
  /**
   * Who pays. `you` is the developer's own key; `server` only ever happens in
   * development, and the distinction is worth carrying rather than inferring.
   */
  billsTo: 'you' | 'server';
};

/**
 * The developer's key in plaintext, which exists in memory for the length of one
 * draft and is returned to nothing else.
 *
 * Read straight from the row rather than through `getUser()`, because that
 * deliberately only ever yields the masked tail -- the point of this being its own
 * function is that the set of callers holding a decrypted key stays countable.
 */
async function storedKey(session?: Session | null): Promise<string | null> {
  const s = session ?? (await readSession());
  if (!s) return null;

  const [row] = await db
    .select({ aiApiKey: users.aiApiKey })
    .from(users)
    .where(eq(users.publicId, s.uid))
    .limit(1);

  if (!row?.aiApiKey) return null;
  /* A key that will not decrypt is no key at all -- `AI_KEY_SECRET` was rotated,
     and the developer has to re-enter it. `getUser()` already reports that state
     as `hasAiKey: false`, so agreeing with it here keeps one story. */
  return decryptSecret(row.aiApiKey);
}

/**
 * The order of preference, and the two different reasons the dev path is gated.
 *
 * A service account in the env is a decision somebody recorded in this project, so
 * it is its own switch -- asking for `GRITQA_DEV_MODEL` on top would be ceremony
 * around a file that already says what it wants. ADC is the opposite: it is ambient
 * state on the machine, left behind by a `gcloud` login for something else
 * entirely, so it needs the explicit flag before it may spend anything.
 *
 * Both are `NODE_ENV !== 'production'`, without exception. This is the path that
 * bills us instead of the developer.
 */
async function choose(session?: Session | null): Promise<Choice | null> {
  const key = await storedKey(session);
  if (key) {
    return {
      on: 'user',
      key,
      name: process.env[MODEL_VAR]?.trim() || DEFAULT_MODEL,
      baseURL: process.env[BASE_URL_VAR]?.trim() || DEFAULT_BASE_URL,
    };
  }

  if (process.env.NODE_ENV === 'production') return null;

  const credentials = serviceAccount();
  if (!credentials && !process.env.GRITQA_DEV_MODEL) return null;

  const project = process.env.GCP_PROJECT_ID?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim();
  if (!project) return null;

  return {
    on: 'vertex',
    name: process.env[MODEL_VAR]?.trim() || DEV_MODEL,
    project,
    location: process.env.GOOGLE_VERTEX_LOCATION?.trim() || 'us-central1',
    credentials,
  };
}

/**
 * Throws rather than returning null, because there is no useful degraded draft.
 * A caller that cannot produce a model has to say so, and `NO_MODEL_KEY` is the
 * state the AI settings page renders as "Drafting off".
 */
export async function resolveModel(session?: Session | null): Promise<ResolvedModel> {
  const choice = await choose(session);
  if (!choice) throw new NoModelKeyError();

  if (choice.on === 'user') {
    /* OpenAI-compatible because that is the contract the settings page states:
       "Any OpenAI-compatible endpoint." One provider shape means a developer can
       point this at whoever they buy tokens from without GritQA shipping a
       provider package per vendor. */
    const provider = createOpenAICompatible({
      name: 'gritqa-user',
      baseURL: choice.baseURL,
      apiKey: choice.key,
    });
    return { model: provider(choice.name), label: choice.name, billsTo: 'you' };
  }

  /* `googleAuthOptions` rather than a token: the provider sets the cloud-platform
     scope itself and asks google-auth-library for a fresh access token per request,
     so a service account here is minted-and-refreshed rather than pasted. Omitting
     `credentials` is what falls through to ADC. */
  const vertex = createVertex({
    project: choice.project,
    location: choice.location,
    ...(choice.credentials ? { googleAuthOptions: { credentials: choice.credentials } } : {}),
  });
  return { model: vertex(choice.name), label: `${choice.name} (dev)`, billsTo: 'server' };
}

/**
 * What the settings page needs to describe drafting without guessing.
 *
 * `aiKeyMasked` alone was enough while a stored key was the only way to draft. It
 * is not any more -- a dev machine with a service account drafts perfectly well
 * with no key stored, and a badge reading that column would say "Drafting off"
 * beside a working button.
 */
export type Drafting = { on: false } | { on: true; billsTo: 'you' | 'server'; label: string };

export async function drafting(session?: Session | null): Promise<Drafting> {
  const choice = await choose(session);
  if (!choice) return { on: false };
  return choice.on === 'user'
    ? { on: true, billsTo: 'you', label: choice.name }
    : { on: true, billsTo: 'server', label: `${choice.name} (dev)` };
}

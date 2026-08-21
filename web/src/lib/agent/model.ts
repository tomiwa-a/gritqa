import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { decryptSecret } from '@/lib/crypto';
import { readSession } from '@/lib/session';

/**
 * Which model drafts, and on whose account.
 *
 * The dashboard has been making a promise about this for months -- "GritQA drafts
 * plans with your key, on your account, so you keep the bill and the choice of
 * model" -- so the developer's own key is not a fallback here, it is the answer.
 * Everything else is scaffolding for a machine that has not been given one.
 */

/** Fixed for the beta, which is what the settings page already tells the developer. */
const MODEL_VAR = 'GRITQA_MODEL';
const BASE_URL_VAR = 'GRITQA_MODEL_BASE_URL';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * `gemini-2.5-flash` through **Vertex**, not AI Studio: the free Generative
 * Language tier is 20 requests a day, which one afternoon of drafting exhausts
 * before lunch. Auth is ADC -- `gcloud auth application-default login` -- so
 * google-auth-library mints and refreshes tokens itself and there is no
 * hour-long token to keep pasting anywhere.
 */
const DEV_MODEL = 'gemini-2.5-flash';

export class NoModelKeyError extends Error {
  readonly code = 'NO_MODEL_KEY';

  constructor() {
    super('NO_MODEL_KEY: no model key is set for this account.');
    this.name = 'NoModelKeyError';
  }
}

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
async function storedKey(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;

  const [row] = await db
    .select({ aiApiKey: users.aiApiKey })
    .from(users)
    .where(eq(users.publicId, session.uid))
    .limit(1);

  if (!row?.aiApiKey) return null;
  /* A key that will not decrypt is no key at all -- `AI_KEY_SECRET` was rotated,
     and the developer has to re-enter it. `getUser()` already reports that state
     as `hasAiKey: false`, so agreeing with it here keeps one story. */
  return decryptSecret(row.aiApiKey);
}

/**
 * Throws rather than returning null, because there is no useful degraded draft.
 * A caller that cannot produce a model has to say so, and `NO_MODEL_KEY` is the
 * state the AI settings page already renders as "Drafting off".
 */
export async function resolveModel(): Promise<ResolvedModel> {
  const key = await storedKey();

  if (key) {
    const baseURL = process.env[BASE_URL_VAR]?.trim() || DEFAULT_BASE_URL;
    const name = process.env[MODEL_VAR]?.trim() || DEFAULT_MODEL;
    /* OpenAI-compatible because that is the contract the settings page states:
       "Any OpenAI-compatible endpoint." One provider shape means a developer can
       point this at whoever they buy tokens from without GritQA shipping a
       provider package per vendor. */
    const provider = createOpenAICompatible({ name: 'gritqa-user', baseURL, apiKey: key });
    return { model: provider(name), label: name, billsTo: 'you' };
  }

  /*
   * The development model, and only in development.
   *
   * Gated the same way the dev sign-in is, and for a sharper reason than
   * convenience: the AI settings page reads "Drafting off" off the absence of a
   * key. A server-side default that worked anyway would make drafting run while
   * the badge said it could not, and would bill us for a developer who never
   * agreed to send anything to a model. The consent panel on that page treats the
   * key *as* the consent -- "removing the key is what revokes that, and it is the
   * only thing that does" -- so a path that drafts without one contradicts it.
   */
  const devAllowed = process.env.NODE_ENV !== 'production' && process.env.GRITQA_DEV_MODEL;
  if (devAllowed) {
    const project = process.env.GOOGLE_VERTEX_PROJECT;
    const location = process.env.GOOGLE_VERTEX_LOCATION ?? 'us-central1';
    if (!project) {
      throw new Error(
        'GRITQA_DEV_MODEL is set but GOOGLE_VERTEX_PROJECT is not. Vertex needs a project id.',
      );
    }
    const vertex = createVertex({ project, location });
    const name = process.env[MODEL_VAR]?.trim() || DEV_MODEL;
    return { model: vertex(name), label: `${name} (dev)`, billsTo: 'server' };
  }

  throw new NoModelKeyError();
}

/** Whether drafting can be attempted at all, without building a provider to find out. */
export async function modelConfigured(): Promise<boolean> {
  if (await storedKey()) return true;
  return Boolean(process.env.NODE_ENV !== 'production' && process.env.GRITQA_DEV_MODEL);
}

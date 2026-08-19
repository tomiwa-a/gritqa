import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * The vault for `users.ai_api_key`.
 *
 * A model key is a bearer credential for someone else's paid account, so it is
 * encrypted at rest rather than merely kept out of responses -- a leaked database
 * dump should not be a leaked pile of API keys. AES-256-GCM because it
 * authenticates as well as encrypts: a tampered ciphertext fails to open instead
 * of decrypting to garbage that gets sent to a provider.
 *
 * The key never travels to the browser. What the dashboard gets is `hasAiKey` and
 * the masked tail from `maskKey`, which is enough to answer "is one set, and is it
 * the one I think it is" and nothing more.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function secret(): Buffer {
  const raw = process.env.AI_KEY_SECRET;
  if (!raw) {
    throw new Error('AI_KEY_SECRET is not set. Generate one with: openssl rand -base64 32');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`AI_KEY_SECRET must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/** Returns `iv.tag.ciphertext`, base64url, which is what the column stores. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, secret(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

/**
 * Returns null rather than throwing when the ciphertext will not open. That
 * happens for one real reason -- `AI_KEY_SECRET` was rotated -- and the honest
 * consequence is that the user has no usable key and must re-enter it, which
 * `hasAiKey: false` already expresses. A throw here would take down a settings
 * page instead.
 */
export function decryptSecret(stored: string): string | null {
  try {
    const [iv, tag, body] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv(ALGORITHM, secret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The only form of a key that reaches a page. Shows the last four characters,
 * which is what lets someone recognise which key is installed without the key
 * being recoverable from what is shown.
 */
export function maskKey(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `${'•'.repeat(12)}${tail}`;
}

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { deviceCodes, projects, users } from '@/lib/db/schema';
import { resolveProjectForUser } from '@/lib/db/auth';
import type { DeviceCodeRow, ProjectRow } from '@/lib/db/schema';

/**
 * The CLI sign-in flow, which is the OAuth device grant with the parts we need.
 *
 * A terminal cannot receive a redirect, so the browser and the CLI have to meet
 * over something a human can carry between them. That is the `user_code`: short
 * enough to read off one screen and type into another. It is therefore guessable,
 * so it grants nothing -- approving it requires an authenticated session, and the
 * thing the CLI ends up holding is keyed to a different secret it never showed
 * anyone.
 */
const TTL_MINUTES = 10;

/** No I, O, 0 or 1. A code that gets read aloud and retyped cannot afford them. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function userCode(): string {
  const bytes = randomBytes(4);
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `GRIT-${body}`;
}

export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode).digest('hex');
}

export type StartedDevice = {
  userCode: string;
  /** Returned once, to the CLI, and never stored in this form. */
  deviceCode: string;
  expiresAt: Date;
};

export async function startDevice(input: {
  hostname?: string | null;
  localPath?: string | null;
  projectName?: string | null;
  repoUrl?: string | null;
  defaultBranch?: string | null;
}): Promise<StartedDevice> {
  const deviceCode = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

  // Housekeeping on the way in, so the table does not need a cron. Expired rows
  // are worthless -- a pending one cannot be approved and a claimed one is spent.
  await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, new Date()));

  // A collision on the short code is unlikely and survivable: retry rather than
  // hand the developer an error about something they did not do.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = userCode();
    try {
      await db.insert(deviceCodes).values({
        userCode: code,
        deviceCodeHash: hashDeviceCode(deviceCode),
        hostname: input.hostname ?? null,
        localPath: input.localPath ?? null,
        projectName: input.projectName ?? null,
        repoUrl: input.repoUrl ?? null,
        defaultBranch: input.defaultBranch ?? null,
        expiresAt,
      });
      return { userCode: code, deviceCode, expiresAt };
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error('unreachable');
}

/** Only a live, unclaimed request is worth showing a human. */
export async function findPendingByUserCode(code: string): Promise<DeviceCodeRow | null> {
  const [row] = await db
    .select()
    .from(deviceCodes)
    .where(and(eq(deviceCodes.userCode, code), sql`${deviceCodes.expiresAt} > now()`))
    .limit(1);
  return row ?? null;
}

/** The 9 characters between a terminal and a browser, and nothing else. */
export function normalizeUserCode(input: string | null | undefined): string | null {
  const clean = (input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 12);
  return clean || null;
}

/**
 * Which project this machine is asking about, and whether it exists yet.
 *
 * The CLI reports the directory it was started in, and that is a better answer than
 * whatever the dashboard's switcher happens to be pointing at -- a developer with
 * six projects is approving *this* checkout.
 *
 * `new` is the case that used to be silently wrong. A directory nothing owns fell
 * back to the session's project, so approving pointed a second checkout at the
 * first one's rows. It is now what it looks like: a project waiting to be added,
 * described well enough for a human to recognise it.
 */
export type DeviceTarget =
  | { kind: 'existing'; project: ProjectRow }
  | { kind: 'new'; name: string; localPath: string; repoUrl: string | null; branch: string }
  | { kind: 'none' };

export async function projectForDevice(
  userId: number,
  row: Pick<DeviceCodeRow, 'localPath' | 'projectName' | 'repoUrl' | 'defaultBranch'>,
  sessionProjectId: string | null,
): Promise<DeviceTarget> {
  if (row.localPath) {
    const [match] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.localPath, row.localPath)))
      .limit(1);
    if (match) return { kind: 'existing', project: match };

    // The CLI names the project it is standing in. Without a name there is nothing
    // to add, so this falls through to whatever the session was already looking at
    // -- which is the pre-0010 CLI, still linking the way it always did.
    if (row.projectName) {
      return {
        kind: 'new',
        name: row.projectName,
        localPath: row.localPath,
        repoUrl: row.repoUrl,
        branch: row.defaultBranch || 'main',
      };
    }
  }
  const fallback = await resolveProjectForUser(userId, sessionProjectId);
  return fallback ? { kind: 'existing', project: fallback } : { kind: 'none' };
}

/**
 * Add the project the CLI described, or return the one that got there first.
 *
 * The unique index on `(user_id, local_path)` is the arbiter: two terminals in the
 * same directory approving at once is one project, not an error either of them
 * should see.
 */
export async function addProjectForDevice(
  userId: number,
  target: Extract<DeviceTarget, { kind: 'new' }>,
): Promise<ProjectRow> {
  const [created] = await db
    .insert(projects)
    .values({
      userId,
      name: target.name,
      localPath: target.localPath,
      repoUrl: target.repoUrl,
      defaultBranch: target.branch,
    })
    .onConflictDoNothing({ target: [projects.userId, projects.localPath] })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.localPath, target.localPath)))
    .limit(1);
  return existing;
}

/** The project a decided request was linked to, for the page that reports it back. */
export async function deviceProjectName(row: DeviceCodeRow): Promise<string | null> {
  if (!row.projectId) return null;
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1);
  return project?.name ?? null;
}

/**
 * Approval is the whole security boundary of this flow, so it takes the approving
 * user's id as an argument rather than reading it -- there is no way to call this
 * without having established who is approving.
 *
 * The `status = 'pending'` predicate makes it single-use under concurrency: two
 * submits race, one updates a row, the other matches nothing.
 */
export async function approveDevice(
  code: string,
  userId: number,
  projectId: number | null,
): Promise<DeviceCodeRow | null> {
  const [row] = await db
    .update(deviceCodes)
    .set({ status: 'approved', userId, projectId, approvedAt: new Date() })
    .where(
      and(
        eq(deviceCodes.userCode, code),
        eq(deviceCodes.status, 'pending'),
        sql`${deviceCodes.expiresAt} > now()`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function denyDevice(code: string): Promise<DeviceCodeRow | null> {
  const [row] = await db
    .update(deviceCodes)
    .set({ status: 'denied' })
    .where(and(eq(deviceCodes.userCode, code), eq(deviceCodes.status, 'pending')))
    .returning();
  return row ?? null;
}

export type ClaimResult =
  | { state: 'pending' }
  | { state: 'denied' }
  | { state: 'expired' }
  | {
      state: 'approved';
      userPublicId: string;
      projectPublicId: string | null;
      projectName: string | null;
    };

/**
 * The CLI polls with its own secret and gets a verdict.
 *
 * Marks the row `claimed` in the same statement that reads it, so a leaked
 * device code cannot be redeemed twice -- a second poll sees `expired`, which is
 * the truth about a spent code.
 */
export async function claimDevice(deviceCode: string): Promise<ClaimResult> {
  const hash = hashDeviceCode(deviceCode);

  const [row] = await db
    .select()
    .from(deviceCodes)
    .where(eq(deviceCodes.deviceCodeHash, hash))
    .limit(1);

  if (!row) return { state: 'expired' };
  if (row.expiresAt.getTime() < Date.now()) return { state: 'expired' };
  if (row.status === 'denied') return { state: 'denied' };
  if (row.status === 'claimed') return { state: 'expired' };
  if (row.status === 'pending') return { state: 'pending' };

  const [claimed] = await db
    .update(deviceCodes)
    .set({ status: 'claimed', claimedAt: new Date() })
    .where(and(eq(deviceCodes.id, row.id), eq(deviceCodes.status, 'approved')))
    .returning();
  if (!claimed || !claimed.userId) return { state: 'expired' };

  const [owner] = await db
    .select({ publicId: users.publicId })
    .from(users)
    .where(eq(users.id, claimed.userId))
    .limit(1);
  if (!owner) return { state: 'expired' };

  let projectPublicId: string | null = null;
  let projectName: string | null = null;
  if (claimed.projectId) {
    const [project] = await db
      .select({ publicId: projects.publicId, name: projects.name })
      .from(projects)
      .where(eq(projects.id, claimed.projectId))
      .limit(1);
    projectPublicId = project?.publicId ?? null;
    projectName = project?.name ?? null;
  }

  return {
    state: 'approved',
    userPublicId: owner.publicId,
    projectPublicId,
    projectName,
  };
}

'use server';

import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { findUserByPublicId } from '@/lib/db/auth';
import {
  approveDevice,
  denyDevice,
  findPendingByUserCode,
  normalizeUserCode,
  projectForDevice,
} from '@/lib/db/device';

/**
 * Approving a machine is the moment a terminal gets to act as the developer, so
 * both of these establish who is asking before they touch the row -- the code on
 * the URL is a public string a stranger could be holding.
 *
 * Denying is gated the same way. It is the harmless half of the decision, but an
 * ungated one lets anyone who can guess a code cancel someone else's sign-in.
 *
 * Both outcomes are audited, and the denial matters more than the approval: a code
 * this developer never asked for, denied from an address they do not recognise, is
 * the one event in the app that says someone else has been holding a device code.
 */
function loginFor(code: string): string {
  return `/login?next=${encodeURIComponent(`/auth/cli?code=${code}`)}`;
}

async function decide(formData: FormData, approve: boolean): Promise<never> {
  const code = normalizeUserCode(String(formData.get('code') ?? ''));
  if (!code) redirect('/auth/cli');

  const session = await readSession();
  if (!session) redirect(loginFor(code));

  const user = await findUserByPublicId(session.uid);
  if (!user) redirect(loginFor(code));

  const row = await findPendingByUserCode(code);
  // Expired, already decided, or never existed. The page re-reads and says which.
  if (!row || row.status !== 'pending') redirect(`/auth/cli?code=${code}`);

  if (approve) {
    const project = await projectForDevice(user.id, row.localPath, session.pid);
    await approveDevice(code, user.id, project?.id ?? null);
  } else {
    await denyDevice(code);
  }

  // The hostname and path are the machine as it described itself, which is what the
  // developer was shown and said yes or no to. Recording them means the entry reads
  // as the decision that was actually made rather than as a code being spent.
  await record({
    userId: user.id,
    action: approve ? 'device.approved' : 'device.denied',
    entityType: 'device_codes',
    entityId: row.id,
    values: { hostname: row.hostname, localPath: row.localPath },
    ip: await clientIp(),
  });

  redirect(`/auth/cli?code=${code}`);
}

export async function approveDeviceAction(formData: FormData): Promise<void> {
  await decide(formData, true);
}

export async function denyDeviceAction(formData: FormData): Promise<void> {
  await decide(formData, false);
}

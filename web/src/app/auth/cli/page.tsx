import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/app/auth-frame';
import { CliApproval } from '@/components/app/cli-approval';
import { findUserByPublicId } from '@/lib/db/auth';
import {
  deviceProjectName,
  findPendingByUserCode,
  normalizeUserCode,
  projectForDevice,
} from '@/lib/db/device';
import { readSession } from '@/lib/session';
import { agoLabel } from '@/lib/when';

export const metadata: Metadata = {
  title: 'Approve the CLI — GritQA',
  robots: { index: false },
};

/**
 * The browser half of the device grant.
 *
 * The code on the URL was printed by a terminal, so it is a claim rather than a
 * credential: every state below is read back out of the database, and the two that
 * change anything are server actions that check the session first.
 */
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const code = normalizeUserCode((await searchParams).code);

  if (!code) {
    return (
      <AuthFrame>
        <CliApproval state="missing" />
      </AuthFrame>
    );
  }

  // Anything not live is indistinguishable from never having existed, which is the
  // right answer to give someone typing codes in one at a time.
  const row = await findPendingByUserCode(code);
  if (!row) {
    return (
      <AuthFrame>
        <CliApproval state="expired" code={code} />
      </AuthFrame>
    );
  }

  if (row.status === 'denied') {
    return (
      <AuthFrame>
        <CliApproval state="denied" />
      </AuthFrame>
    );
  }

  // Approved and claimed look the same to the person who approved it: the decision
  // is made, and the only difference is whether the CLI has collected it yet.
  if (row.status !== 'pending') {
    return (
      <AuthFrame>
        <CliApproval
          state="linked"
          projectName={await deviceProjectName(row)}
          collected={row.status === 'claimed'}
        />
      </AuthFrame>
    );
  }

  // A decision needs a decider. Sign-in carries the code along so it comes back
  // here rather than dropping the person on the dashboard.
  const session = await readSession();
  const user = session ? await findUserByPublicId(session.uid) : null;
  if (!session || !user) {
    redirect(`/login?next=${encodeURIComponent(`/auth/cli?code=${code}`)}`);
  }

  const project = await projectForDevice(user.id, row.localPath, session.pid);

  return (
    <AuthFrame>
      <CliApproval
        state="pending"
        code={code}
        projectName={project?.name ?? null}
        requestedLabel={agoLabel(row.createdAt)}
        hostname={row.hostname}
        localPath={row.localPath}
      />
    </AuthFrame>
  );
}

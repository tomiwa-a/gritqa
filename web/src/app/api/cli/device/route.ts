import { NextResponse } from 'next/server';
import { startDevice } from '@/lib/db/device';
import { appOrigin } from '@/lib/oauth';

/**
 * The CLI asks to be linked. Unauthenticated by necessity -- this is the call a
 * machine with no credential makes to get one -- so it grants nothing on its own:
 * what comes back is a code that is worthless until a signed-in human approves it.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: {
    hostname?: string;
    localPath?: string;
    name?: string;
    branch?: string;
    repoUrl?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // A CLI that sends nothing is fine; the fields only decorate the approval screen.
  }

  const device = await startDevice({
    // Truncated because they land in bounded columns and because they are shown to
    // a human on the approval screen, where a pathological hostname is a layout bug.
    hostname: body.hostname?.slice(0, 255) ?? null,
    localPath: body.localPath?.slice(0, 1024) ?? null,
    // What the CLI proposes to add, if this directory is one the dashboard has
    // never seen. Nothing is created here -- an unapproved code names a project
    // the same way it names a hostname, which is to say it only describes one.
    projectName: body.name?.trim().slice(0, 255) || null,
    repoUrl: body.repoUrl?.trim().slice(0, 1024) || null,
    defaultBranch: body.branch?.trim().slice(0, 255) || null,
  });

  return NextResponse.json(
    {
      userCode: device.userCode,
      deviceCode: device.deviceCode,
      verificationUri: `${appOrigin()}/auth/cli?code=${device.userCode}`,
      expiresAt: device.expiresAt.toISOString(),
      /** Seconds the CLI should wait between polls. */
      interval: 2,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

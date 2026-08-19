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
  let body: { hostname?: string; localPath?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // A CLI that sends nothing is fine; the fields only decorate the approval screen.
  }

  const device = await startDevice({
    // Truncated because both land in a VARCHAR and because they are shown to a
    // human on the approval screen, where a pathological hostname is a layout bug.
    hostname: body.hostname?.slice(0, 255) ?? null,
    localPath: body.localPath?.slice(0, 1024) ?? null,
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

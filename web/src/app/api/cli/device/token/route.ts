import { NextResponse } from 'next/server';
import { claimDevice } from '@/lib/db/device';
import { newCliToken, signSession } from '@/lib/session';

/**
 * The CLI polls here with the device code it kept. One of four answers, and the
 * status codes are the ones the device grant spec uses so a stock HTTP client can
 * branch on them without reading the body:
 *
 *   202  still waiting on a human
 *   403  a human said no
 *   410  expired, or already claimed -- start over
 *   200  approved, here is the credential
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let deviceCode: string | undefined;
  try {
    ({ deviceCode } = (await request.json()) as { deviceCode?: string });
  } catch {
    deviceCode = undefined;
  }

  if (!deviceCode) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await claimDevice(deviceCode);
  const headers = { 'Cache-Control': 'no-store' };

  if (result.state === 'pending') {
    return NextResponse.json({ error: 'authorization_pending' }, { status: 202, headers });
  }
  if (result.state === 'denied') {
    return NextResponse.json({ error: 'access_denied' }, { status: 403, headers });
  }
  if (result.state === 'expired') {
    return NextResponse.json({ error: 'expired_token' }, { status: 410, headers });
  }

  return NextResponse.json(
    {
      token: await signSession(newCliToken(result.userPublicId, result.projectPublicId)),
      tokenType: 'Bearer',
      project: result.projectPublicId
        ? { publicId: result.projectPublicId, name: result.projectName }
        : null,
    },
    { headers },
  );
}

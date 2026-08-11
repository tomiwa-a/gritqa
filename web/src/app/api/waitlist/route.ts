import { NextResponse } from 'next/server';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Malformed request.' },
      { status: 400 },
    );
  }

  const { email, botField } = (body ?? {}) as { email?: string; botField?: string };

  if (botField) return NextResponse.json({ ok: true });

  if (typeof email !== 'string' || !EMAIL.test(email.trim())) {
    return NextResponse.json(
      { ok: false, error: 'Enter a valid email address.' },
      { status: 422 },
    );
  }

  const address = email.trim().toLowerCase();
  const sink = process.env.WAITLIST_WEBHOOK_URL;

  if (!sink) {
    console.info('[waitlist] signup (no WAITLIST_WEBHOOK_URL configured):', address);
    return NextResponse.json({ ok: true });
  }

  try {
    const res = await fetch(sink, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, source: 'landing' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`sink responded ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[waitlist] forward failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Could not save your email. Please try again.' },
      { status: 502 },
    );
  }
}

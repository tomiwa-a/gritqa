import { NextResponse, type NextRequest } from 'next/server';
import { clearSession } from '@/lib/session';

/**
 * POST, not GET. A link that signs you out can be triggered by any page that
 * embeds it -- an <img> tag is enough -- and while getting logged out is a mild
 * thing to have done to you, a state-changing GET is still a state-changing GET.
 * The user menu posts a form, so it works without JavaScript.
 *
 * 303, not the 307 that `redirect()` produces here: 307 preserves the method, so
 * the browser would go on to POST `/login` and leave a form submission sitting in
 * the history. 303 is the code that means "your POST is done, now go GET this".
 */
export async function POST(request: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}

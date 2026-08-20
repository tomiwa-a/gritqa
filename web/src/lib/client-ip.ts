import { isIP } from 'node:net';
import { headers } from 'next/headers';

/**
 * The address a request appeared to come from.
 *
 * Both headers read below are written by whatever sits in front of the app, and
 * nothing stops a client sending them itself -- so this is where the request said it
 * came from, which is a different claim from where it came from. That is the right
 * thing for an audit log to keep and the wrong thing to decide anything on, and
 * nothing in this app authorises anything by address.
 *
 * `audit_logs.ip_address` is INET, so a malformed value is a failed INSERT rather
 * than an untidy row -- and since the insert carries the whole entry, a bad address
 * would cost the record of the action. Hence `isIP`: anything that is not plainly an
 * address becomes null, and the row lands without one.
 */
function normalize(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  // `[2001:db8::1]:54321`. An address containing colons has to be bracketed before a
  // port can be appended to it, which is the one form that says outright which is which.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) {
    value = bracketed[1];
  } else if ((value.match(/:/g)?.length ?? 0) === 1) {
    // `203.0.113.7:54321`. A bare IPv6 address has more than one colon, so a single
    // one is unambiguously a port.
    value = value.slice(0, value.indexOf(':'));
  }

  return isIP(value) ? value : null;
}

export async function clientIp(): Promise<string | null> {
  const inbound = await headers();

  // A single address when a proxy sets one, which needs no interpretation.
  const direct = inbound.get('x-real-ip');
  if (direct) {
    const ip = normalize(direct);
    if (ip) return ip;
  }

  // Otherwise the chain, left to right: client, then each proxy that forwarded it.
  // The leftmost entry is the one worth showing a developer -- their laptop, not our
  // load balancer -- and also the one a client can invent, which is the trade this
  // whole file is a comment on.
  const forwarded = inbound.get('x-forwarded-for');
  for (const part of (forwarded ?? '').split(',')) {
    const ip = normalize(part);
    if (ip) return ip;
  }

  // A direct connection over localhost has no forwarding headers at all, which is
  // most of development. An entry without an address still says what happened.
  return null;
}

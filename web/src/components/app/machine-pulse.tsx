'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** Comfortably inside the 30-second window, so a flip is noticed rather than inferred. */
const EVERY_MS = 10_000;

/**
 * Keeps the server's answer about the machine from going stale on screen.
 *
 * It renders nothing. Its whole job is to notice that `connected` has changed and
 * call `router.refresh()`, which re-runs the server components and lets every gate
 * on the page -- the disabled Run buttons, the topbar pill, the note under the
 * decision bar -- become correct without any of them learning to fetch.
 *
 * Refreshing only on a *change* is the point. Polling and refreshing every ten
 * seconds regardless would re-render the whole route tree all afternoon to confirm
 * nothing had happened; the state of a developer's laptop changes a handful of times
 * a day.
 *
 * Paused while the tab is hidden. A background tab is not being read, and a laptop
 * with twenty of them should not be sending twenty requests every ten seconds. The
 * `visibilitychange` handler polls immediately on return, so coming back to a tab
 * shows the current answer rather than the one from when it was last looked at.
 */
export function MachinePulse({ connected }: { connected: boolean }) {
  const router = useRouter();

  /* A ref, not state: this is the answer currently on screen, and writing it must
     not re-render -- the refresh is the only output this component has. Synced from
     the prop in an effect rather than during render, so that after a refresh the
     baseline is what the server just said and not what the poll last saw. */
  const known = useRef(connected);
  useEffect(() => {
    known.current = connected;
  }, [connected]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped || document.hidden) return;
      try {
        const response = await fetch('/api/machine', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { connected?: unknown };
        if (typeof body.connected !== 'boolean') return;
        if (body.connected !== known.current) {
          known.current = body.connected;
          router.refresh();
        }
      } catch {
        /* A failed poll is not news. The next one is in ten seconds, and a network
           blip should not make the page claim the machine went away -- only the
           server gets to decide that, from `last_seen_at`. */
      }
    }

    function tick() {
      timer = setTimeout(async () => {
        await poll();
        if (!stopped) tick();
      }, EVERY_MS);
    }

    function onVisible() {
      if (!document.hidden) void poll();
    }

    document.addEventListener('visibilitychange', onVisible);
    tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}

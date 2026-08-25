'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Faster than the machine poller, because the thing being watched is faster.
 *
 * A machine's liveness flips a handful of times a day. A drafting job says something
 * new every few seconds while it reads, and a transcript that arrives in eight-second
 * clumps reads as a page that is working -- one that arrives in half-minute clumps
 * reads as a page that is stuck.
 */
const EVERY_MS = 4_000;

/**
 * Keeps the work page from going stale while the work is happening.
 *
 * It renders nothing. Its whole job is to notice that the server's answer has changed
 * and call `router.refresh()`, which re-runs the page and lets the rows, the
 * transcript, the badge and the finished links all become correct without any of them
 * learning to fetch.
 *
 * Refreshing only on a *change* is what makes a four-second poll affordable. `mark`
 * is stable while nothing is in flight, so an idle project costs one small query every
 * four seconds and zero re-renders -- and the moment a job starts, every poll that
 * sees a new note redraws the page.
 *
 * Paused while the tab is hidden, and polled immediately on return, so coming back to
 * a tab shows where the work got to rather than where it was when you left.
 */
export function WorkPulse({ mark }: { mark: string }) {
  const router = useRouter();

  /* A ref, not state: this is the answer currently on screen, and writing it must not
     re-render -- the refresh is the only output this component has. Synced from the
     prop in an effect rather than during render, so that after a refresh the baseline
     is what the server just said and not what the poll last saw. */
  const known = useRef(mark);
  useEffect(() => {
    known.current = mark;
  }, [mark]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped || document.hidden) return;
      try {
        const response = await fetch('/api/work', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { mark?: unknown };
        if (typeof body.mark !== 'string') return;
        if (body.mark !== known.current) {
          known.current = body.mark;
          router.refresh();
        }
      } catch {
        /* A failed poll is not news. The next one is in four seconds, and a network
           blip must not make the page claim the work stopped -- only the row says
           that. */
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

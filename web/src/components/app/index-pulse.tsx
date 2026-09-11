'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Faster than the machine poller, for the same reason as the work poller: an
 * index pass says something new every second while it reads, and a stage list
 * that moves in four-second steps reads as a page that is working.
 *
 * Refreshing only on a *change* is what makes this affordable. The compared
 * mark folds connected, stage, counters, current file and failure count into
 * one string; a finished pass stops moving it, so an idle project costs one
 * small query every four seconds and zero re-renders.
 *
 * Paused while the tab is hidden, and polled immediately on return.
 */
const EVERY_MS = 4_000;

export function IndexPulse({ mark }: { mark: string }) {
  const router = useRouter();

  /* A ref, not state: this is the answer currently on screen, and writing it
     must not re-render -- the refresh is the only output this component has.
     Synced from the prop in an effect rather than during render, so that after
     a refresh the baseline is what the server just said. */
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
        const response = await fetch('/api/machine', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { connected?: unknown; progress?: unknown };
        if (typeof body.connected !== 'boolean') return;
        const next = `${body.connected}:${JSON.stringify(body.progress ?? null)}`;
        if (next !== known.current) {
          known.current = next;
          router.refresh();
        }
      } catch {
        /* A failed poll is not news. The next one is in four seconds, and only
           the server gets to say the machine went away. */
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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/badge';

const GROUPS: { title: string; keys: { keys: string[]; what: string }[] }[] = [
  {
    title: 'Move',
    keys: [
      { keys: ['J', '↓'], what: 'Next draft' },
      { keys: ['K', '↑'], what: 'Previous draft' },
    ],
  },
  {
    title: 'Decide',
    keys: [
      { keys: ['A'], what: 'Approve' },
      { keys: ['E'], what: 'Send it back' },
    ],
  },
  {
    title: 'Open',
    keys: [
      { keys: ['↵'], what: 'The full plan' },
      { keys: ['?'], what: 'This list' },
    ],
  },
];

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function QueueKeys({
  ids,
  selectedId,
  queuePath,
  planPathBase,
}: {
  ids: string[];
  selectedId: string;
  queuePath: string;
  planPathBase: string;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    const go = (id: string) => router.push(`${queuePath}?plan=${id}`, { scroll: false });

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;

      const at = ids.indexOf(selectedId);

      if (e.key === 'Escape' && sheet) {
        setSheet(false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setSheet((v) => !v);
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        go(ids[Math.min(at + 1, ids.length - 1)]);
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        go(ids[Math.max(at - 1, 0)]);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        router.push(`${planPathBase}/${selectedId}`);
        return;
      }
      if (e.key === 'a' || e.key === 'e') {
        e.preventDefault();
        const decision = e.key === 'a' ? 'approve' : 'reject';
        document.querySelector<HTMLButtonElement>(`[data-decision="${decision}"]`)?.click();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ids, selectedId, queuePath, planPathBase, router, sheet]);

  return (
    <>
      <button
        type="button"
        onClick={() => setSheet(true)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <Icon name="terminal" size={13} className="text-ink-subtle" />
        <span className="hidden sm:inline">Shortcuts</span>
        <Kbd>?</Kbd>
      </button>

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={() => setSheet(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="relative flex w-[19.5rem] max-w-full flex-col overflow-hidden rounded-xl border border-rule bg-app-panel shadow-menu"
          >
            <header className="flex items-start gap-3 border-b border-rule-soft px-4 pt-3.5 pb-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink-subtle uppercase">
                  Keyboard
                </p>
                <h3 className="mt-1 text-[13.5px] font-medium text-ink">
                  Triage without the mouse
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSheet(false)}
                aria-label="Close shortcuts"
                className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            </header>

            <div className="flex flex-col px-4 py-1">
              {GROUPS.map((group) => (
                <section key={group.title} className="border-b border-rule-soft py-3 last:border-b-0">
                  <h4 className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
                    {group.title}
                  </h4>
                  <dl className="mt-2 flex flex-col gap-2">
                    {group.keys.map((row) => (
                      <div key={row.what} className="flex items-center gap-3">
                        <dt className="text-[12.5px] text-ink-muted">{row.what}</dt>
                        <dd className="ml-auto flex shrink-0 items-center gap-1">
                          {row.keys.map((key) => (
                            <Kbd key={key} className="bg-app">
                              {key}
                            </Kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>

            <footer className="flex items-center gap-2 border-t border-rule-soft bg-app px-4 py-2.5">
              <Kbd className="bg-app-panel">Esc</Kbd>
              <span className="text-[11.5px] text-ink-subtle">closes this</span>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

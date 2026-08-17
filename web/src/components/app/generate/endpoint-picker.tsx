'use client';

import { useState } from 'react';
import { MethodBadge, type Method } from '@/components/ui/method-badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { COVERAGE_FILL, COVERAGE_LABEL } from '@/lib/coverage';
import type { CoverageState } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

export type PickerEndpoint = { key: string; method: Method; path: string; state: CoverageState };
export type PickerFile = { file: string; endpoints: PickerEndpoint[] };

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150',
        on ? 'border-ink bg-ink text-ink-inverse' : 'border-rule-strong bg-app-panel',
      )}
    >
      {on && <Icon name="check" size={11} />}
    </span>
  );
}

export function EndpointPicker({
  files,
  preselected = [],
}: {
  files: PickerFile[];
  preselected?: string[];
}) {
  const [picked, setPicked] = useState<string[]>(preselected);
  const has = (key: string) => picked.includes(key);

  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const toggleFile = (file: PickerFile) => {
    const keys = file.endpoints.map((e) => e.key);
    const all = keys.every((k) => picked.includes(k));
    setPicked((prev) => (all ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])]));
  };

  return (
    <div className="flex flex-col">
      {files.map((file) => {
        const keys = file.endpoints.map((e) => e.key);
        const chosen = keys.filter((k) => has(k)).length;

        return (
          <section key={file.file} className="border-b border-rule-soft last:border-b-0">
            <div className="flex items-center gap-3 bg-app px-4 py-2">
              <button
                type="button"
                onClick={() => toggleFile(file)}
                aria-pressed={chosen === keys.length}
                className="flex min-w-0 items-center gap-2.5 text-left"
              >
                <Box on={chosen === keys.length} />
                <span className="truncate font-mono text-[11.5px] text-ink-muted">{file.file}</span>
              </button>
              <span className="nums ml-auto shrink-0 text-[11px] text-ink-subtle">
                {chosen ? `${chosen} of ${keys.length}` : `${keys.length} endpoints`}
              </span>
            </div>

            <ul>
              {file.endpoints.map((e) => {
                const on = has(e.key);
                return (
                  <li key={e.key}>
                    <button
                      type="button"
                      onClick={() => toggle(e.key)}
                      aria-pressed={on}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150',
                        on ? 'bg-app-active' : 'hover:bg-app-hover',
                      )}
                    >
                      <Box on={on} />
                      <MethodBadge method={e.method} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {e.path}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', COVERAGE_FILL[e.state])} />
                        <span className="hidden text-[11.5px] text-ink-subtle sm:inline">
                          {COVERAGE_LABEL[e.state]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-rule bg-app-panel/95 px-4 py-3 backdrop-blur-sm">
        <Button
          variant="primary"
          size="sm"
          disabled={picked.length === 0}
          title={
            picked.length === 0
              ? 'Pick at least one endpoint first'
              : `Draft plans covering ${picked.length} endpoints`
          }
        >
          <Icon name="sparkle" size={14} />
          Draft plans
          {picked.length > 0 && <span className="nums">· {picked.length}</span>}
        </Button>

        {picked.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
            Clear
          </Button>
        )}

        <p className="text-[11.5px] leading-snug text-ink-subtle">
          {picked.length === 0
            ? 'Nothing picked yet.'
            : 'GritQA reads these together, so one plan can cover several of them in order.'}
        </p>
      </div>
    </div>
  );
}

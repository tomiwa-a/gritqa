'use client';

import { useState } from 'react';
import { MethodBadge, type Method } from '@/components/ui/method-badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { COVERAGE_FILL, COVERAGE_LABEL } from '@/lib/coverage';
import type { CoverageState } from '@/lib/model';
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
    setPicked((prev) =>
      all ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])],
    );
  };

  return (
    <div className="flex flex-col">
      {/* What you have picked, not what to do about it — advancing the wizard
          belongs to the one button in the footer, and saying it twice is worse
          than saying it once. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule bg-app-panel/95 px-4 py-2.5 backdrop-blur-sm">
        <p className="nums shrink-0 text-[12px] font-medium text-ink">
          {picked.length === 0 ? 'Nothing picked yet' : `${picked.length} picked`}
        </p>

        {picked.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
            Clear
          </Button>
        )}

        <p className="text-[11.5px] leading-snug text-ink-subtle">
          {picked.length === 0
            ? 'Pick the endpoints the drafts should cover.'
            : 'GritQA reads these together, so one plan can cover several of them in order.'}
        </p>
      </div>

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
                      {/* The box is 30rem wide, so coverage is a dot with a
                          name on it rather than a column of repeated words. */}
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', COVERAGE_FILL[e.state])}
                        title={COVERAGE_LABEL[e.state]}
                      />
                      <span className="sr-only">{COVERAGE_LABEL[e.state]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Modal } from '../modal';
import { MethodBadge, type Method } from '@/components/ui/method-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { COVERAGE_FILL, COVERAGE_LABEL } from '@/lib/coverage';
import { endpointsPrefill, withOverlayParams, type PageParams } from '@/lib/overlay';
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

/**
 * Step two of the endpoints door, and it owns the whole `Modal` for the reason
 * `DraftForm` does: the button that advances the wizard has to know how many
 * endpoints are ticked, and the ticks live here. A footer on the far side of the
 * server boundary could not see them, which is how this step spent a while with no
 * way forward at all -- the picks never left the browser, so the only live button
 * was the one that gave up and went to the describe journey.
 *
 * Forward writes the picks onto the URL and lets the describe step compose the
 * brief. Back reads them off it again, so a round trip through the brief box does
 * not cost you four clicks of picking.
 */
export function EndpointPicker({
  files,
  preselected = [],
  title,
  closeHref,
  pathname,
  params,
  above,
}: {
  files: PickerFile[];
  preselected?: string[];
  title: string;
  closeHref: string;
  /** The page underneath, so this can build its own hrefs off the params it was given. */
  pathname: string;
  params: PageParams;
  /** The focus note and the state filter, rendered on the server and handed down. */
  above?: ReactNode;
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

  /* Picks the current filter is not showing. Kept rather than dropped, because
     narrowing the list is not the same act as changing your mind -- but said out
     loud, because a count that disagrees with what is on screen is a count nobody
     trusts. */
  const showing = new Set(files.flatMap((file) => file.endpoints.map((e) => e.key)));
  const hidden = picked.filter((key) => !showing.has(key)).length;

  const href = (patch: Record<string, string | undefined>) =>
    withOverlayParams(pathname, params, patch);

  return (
    <Modal
      id="generate-modal"
      closeHref={closeHref}
      label="draft plans"
      eyebrow="Draft plans · Step 2 of 3"
      title={title}
      progress={{ current: 2, total: 3 }}
      footer={
        <div className="flex items-center gap-2">
          <Link
            href={href({ g: 'source' })}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Icon name="arrowRight" size={14} className="rotate-180" />
            Back
          </Link>

          {/* The escape hatch, and it is quiet on purpose: it is the live path when
              nothing is ticked and the wrong one the moment something is. */}
          <Link
            href={href({ from: 'blank', g: 'scope', prefill: undefined })}
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}
          >
            Describe instead
          </Link>

          {picked.length > 0 ? (
            <Link
              href={href({ from: 'blank', g: 'scope', prefill: endpointsPrefill(picked) })}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <Icon name="sparkle" size={14} />
              Continue with {picked.length}
            </Link>
          ) : (
            <Button type="button" variant="primary" size="sm" disabled>
              <Icon name="sparkle" size={14} />
              Continue
            </Button>
          )}
        </div>
      }
    >
      {above}

      {/* What you have picked, not what to do about it — that is the footer's job,
          and saying it twice is worse than saying it once. */}
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
            : hidden > 0
              ? `${hidden} of them ${hidden === 1 ? 'is' : 'are'} outside this filter, and still counted.`
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
    </Modal>
  );
}

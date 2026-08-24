'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { MethodBadge } from '@/components/ui/method-badge';
import { observedCallAction } from '@/lib/actions/observed';
import { agoLabelOrNull } from '@/lib/when';
import type { ObservedCall, ObservedRoute } from '@/lib/model';
import { MONO } from './editor-parts';
import { cn } from '@/lib/cn';

/**
 * What this project has really sent, offered to the step being written.
 *
 * The honest answer to "does GritQA know this endpoint's request and response" is: only
 * where a run has made that call. So this is a record and not a schema -- it shows the last
 * real exchange, and the reader decides whether it is the endpoint they meant. The
 * alternative was matching a typed url back to a route pattern, which is guessing dressed
 * as help.
 *
 * Filling is one button and it is theirs to press. A picker that wrote into the form on
 * selection would make looking something up indistinguishable from committing to it.
 */
export function ObservedPicker({
  routes,
  onFill,
}: {
  routes: ObservedRoute[];
  onFill: (call: ObservedCall) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [call, setCall] = useState<ObservedCall | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, start] = useTransition();

  if (routes.length === 0) {
    return (
      <p className="text-[11.5px] leading-snug text-ink-subtle">
        No run has called this API yet, so there is no record of what its endpoints take or
        answer. Once a plan runs, every call it made shows up here to write the next one against.
      </p>
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? routes.filter((r) => `${r.method} ${r.path}`.toLowerCase().includes(needle))
    : routes;

  const pick = (route: ObservedRoute) => {
    setMissing(false);
    start(async () => {
      const found = await observedCallAction(route.method, route.path);
      setCall(found);
      setMissing(found === null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start text-[11.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {routes.length === 1
          ? 'The one endpoint a run has called'
          : `${routes.length} endpoints a run has called`}
      </button>

      {open && (
        <>
          {routes.length > 6 && (
            <Input
              dense
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              className={MONO}
            />
          )}

          <ul className="max-h-56 overflow-y-auto rounded-lg border border-rule">
            {shown.map((route) => {
              const on = call?.method === route.method && call?.path === route.path;
              return (
                <li key={`${route.method} ${route.path}`}>
                  <button
                    type="button"
                    onClick={() => pick(route)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150',
                      on ? 'bg-app-active' : 'hover:bg-app-hover',
                    )}
                  >
                    <MethodBadge method={route.method} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                      {route.path}
                    </span>
                    <span className="nums shrink-0 text-[11px] text-ink-subtle">
                      {route.status ?? '—'}
                    </span>
                    <span className="nums w-16 shrink-0 text-right text-[11px] text-ink-subtle">
                      {agoLabelOrNull(route.lastRunAt) ?? ''}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="px-2 py-3 text-center text-[11.5px] text-ink-subtle">
                Nothing called matches that.
              </li>
            )}
          </ul>

          {loading && <p className="text-[11.5px] text-ink-subtle">Reading the last call…</p>}
          {missing && !loading && (
            <p className="text-[11.5px] text-ink-subtle">
              That call is no longer on record — its run may have been cleared.
            </p>
          )}
          {call && !loading && <Exchange call={call} onFill={() => onFill(call)} />}
        </>
      )}
    </div>
  );
}

/**
 * One recorded exchange, as it was stored. Both bodies are exactly what crossed the wire,
 * which is the point and also worth saying out loud: a token the API minted is in here if it
 * minted one.
 */
function Exchange({ call, onFill }: { call: ObservedCall; onFill: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rule bg-app px-2.5 py-2">
      <div className="flex items-center gap-2">
        <MethodBadge method={call.method} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
          {call.path}
        </span>
        <span className="nums shrink-0 text-[11px] text-ink-subtle">
          answered {call.status ?? '—'}
          {call.calls > 1 ? `, called ${call.calls}×` : ''}
        </span>
        <Button variant="secondary" size="xs" onClick={onFill}>
          Use it
        </Button>
      </div>

      <Body label="Sent" text={call.request} empty="Nothing — the call carried no body." />
      <Body label="Came back" text={call.response} empty="Nothing." />

      {call.clipped && (
        <p className="text-[11px] text-ink-subtle">Cut to fit. What is shown is the start of it.</p>
      )}
      <p className="text-[11px] leading-snug text-ink-subtle">
        Stored as it crossed the wire, so anything the API returned is in it verbatim.
      </p>
    </div>
  );
}

function Body({ label, text, empty }: { label: string; text: string | null; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
        {label}
      </span>
      {text ? (
        <pre className="max-h-40 overflow-auto rounded border border-rule-soft bg-app-panel px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
          {text}
        </pre>
      ) : (
        <p className="text-[11.5px] text-ink-subtle">{empty}</p>
      )}
    </div>
  );
}

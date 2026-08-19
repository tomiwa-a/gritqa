import { Icon } from '@/components/ui/icon';
import { getCoverage, getCurrentProject } from '@/lib/data';
import type { CoverageFile } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

const RINGS = [
  { size: 104, delay: 0 },
  { size: 76, delay: 300 },
  { size: 48, delay: 600 },
];

const METHOD_FILL: Record<string, string> = {
  GET: 'bg-series-1',
  POST: 'bg-series-2',
  PATCH: 'bg-series-3',
  PUT: 'bg-series-4',
  DELETE: 'bg-series-5',
};

function methodMixOf(coverage: CoverageFile[]) {
  const all = coverage.flatMap((f) => f.endpoints);
  const counts = new Map<string, number>();
  for (const endpoint of all) counts.set(endpoint.method, (counts.get(endpoint.method) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({ method, count, share: (count / all.length) * 100 }));
}

function Beacon({ connected }: { connected: boolean }) {
  return (
    <div className="relative flex h-[104px] items-center justify-center">
      {RINGS.map((ring) => (
        <span
          key={ring.size}
          aria-hidden
          style={{
            width: ring.size,
            height: ring.size,
            animationDelay: connected ? undefined : `${ring.delay}ms`,
          }}
          className={cn(
            'absolute rounded-full border',
            connected ? 'border-term-pass/20' : 'animate-ping border-punch-red/35',
          )}
        />
      ))}
      <span
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-full',
          connected ? 'bg-term-pass text-surface-dark' : 'bg-punch-red text-white',
        )}
      >
        <Icon name={connected ? 'check' : 'terminal'} size={15} strokeWidth={2} />
      </span>
    </div>
  );
}

export async function WaitingBeacon() {
  const [coverage, currentProject] = await Promise.all([getCoverage(), getCurrentProject()]);
  const methodMix = methodMixOf(coverage);
  const connected = currentProject.lastIndexedLabel !== null;

  return (
    <div className="flex h-full flex-col justify-center">
      <Beacon connected={connected} />

      <p className="mt-2 text-center font-mono text-[11px] tracking-[0.08em] text-term-dim">
        {connected ? `read ${currentProject.lastIndexedLabel}` : 'listening for your first run'}
      </p>

      {connected ? (
        <div className="mt-4 rounded-lg border border-rule-dark bg-surface-dark-raised p-3">
          <p className="font-mono text-[10.5px] tracking-[0.16em] text-term-dim uppercase">
            What it found
          </p>

          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {[
              { value: currentProject.fileCount, label: 'files' },
              { value: currentProject.endpointCount, label: 'endpoints' },
              { value: 'Go', label: 'language' },
            ].map((cell) => (
              <div key={cell.label}>
                <p className="nums text-[17px] leading-none font-semibold text-ink-inverse">
                  {cell.value}
                </p>
                <p className="mt-1 font-mono text-[10px] text-term-dim">{cell.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-3.5 flex h-1.5 gap-px overflow-hidden rounded-full">
            {methodMix.map((entry) => (
              <span
                key={entry.method}
                style={{ width: `${entry.share}%` }}
                className={METHOD_FILL[entry.method] ?? 'bg-rule-dark'}
              />
            ))}
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
            {methodMix.map((entry) => (
              <li key={entry.method} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-[2px]',
                    METHOD_FILL[entry.method] ?? 'bg-rule-dark',
                  )}
                />
                <span className="font-mono text-[10px] text-term-dim">{entry.method}</span>
                <span className="nums font-mono text-[10px] text-ink-dim">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-rule-dark bg-surface-dark-raised p-3 text-[11.5px] leading-snug text-term-dim">
          This flips to a green light the moment the CLI reports in, and fills with what it found —
          files, endpoints, and the languages it recognised.
        </p>
      )}
    </div>
  );
}

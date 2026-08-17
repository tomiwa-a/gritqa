import Link from 'next/link';
import { Delta } from './delta';
import { planPassRates } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

const SERIES = ['bg-series-1', 'bg-series-2', 'bg-series-3', 'bg-series-4', 'bg-series-5'];

export function PlanRates() {
  return (
    <ul className="flex flex-col gap-1">
      {planPassRates.map((p) => (
        <li key={p.name}>
          <Link
            href={`/dashboard/test-plans/${p.planPublicId}`}
            title={`${p.name} — ${p.rate}% across ${p.runs} runs`}
            className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-app-hover"
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', SERIES[p.series - 1])} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{p.name}</span>
              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-app-active">
                <span
                  className={cn('block h-full rounded-full', SERIES[p.series - 1])}
                  style={{ width: `${p.rate}%` }}
                />
              </span>
            </span>

            <span className="nums w-[42px] shrink-0 text-right text-[12.5px] font-medium text-ink">
              {p.rate}%
            </span>

            <Delta
              direction={p.direction}
              value={p.delta}
              tone={p.direction === 'up' ? 'good' : p.direction === 'down' ? 'bad' : 'neutral'}
              className="w-[46px] shrink-0 justify-center"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

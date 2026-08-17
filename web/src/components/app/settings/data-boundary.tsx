import { Icon } from '@/components/ui/icon';

const SENT = [
  { path: 'routes/checkout.go', lines: 148 },
  { path: 'handlers/pay.go', lines: 96 },
  { path: 'models/order.go', lines: 61 },
];

const HELD = [
  'Environment files, secrets, and tokens',
  'Anything in your database',
  'The requests and responses from your runs',
];

export function DataBoundary() {
  const lines = SENT.reduce((sum, file) => sum + file.lines, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-surface-dark bg-grid-dark">
      <div className="flex items-center gap-2 border-b border-rule-dark px-4 py-3">
        <Icon name="shield" size={14} className="text-term-dim" />
        <h3 className="font-mono text-[11px] tracking-[0.16em] text-term-dim uppercase">
          What leaves your machine
        </h3>
      </div>

      <div className="grid sm:grid-cols-2">
        <div className="border-b border-rule-dark p-4 sm:border-b-0 sm:border-r">
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-term-dim uppercase">
            sent to draft a plan
          </p>

          <ul className="mt-2.5 flex flex-col gap-1.5">
            {SENT.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-2 rounded-md border border-rule-dark bg-surface-dark-raised px-2.5 py-1.5"
              >
                <Icon name="codebase" size={12} className="shrink-0 text-term-dim" />
                <span className="truncate font-mono text-[11px] text-ink-dim">{file.path}</span>
                <span className="nums ml-auto shrink-0 font-mono text-[10.5px] text-term-dim">
                  {file.lines}
                </span>
              </li>
            ))}
          </ul>

          <p className="nums mt-2.5 font-mono text-[10.5px] text-term-dim">
            {SENT.length} changed files · {lines} lines
          </p>
        </div>

        <div className="p-4">
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-term-dim uppercase">
            held back
          </p>

          <ul className="mt-2.5 flex flex-col gap-2">
            {HELD.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Icon name="close" size={12} className="mt-[3px] shrink-0 text-term-fail" />
                <span className="text-[11.5px] leading-snug text-ink-dim">{item}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 border-t border-rule-dark pt-3 text-[11px] leading-snug text-term-dim">
            Only the files that changed, only to the provider holding the key above. Turn drafting
            off and nothing goes anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}

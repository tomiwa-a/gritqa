import { Icon } from '@/components/ui/icon';

const LOCAL = ['gritqa — the CLI you just installed', 'your source, never uploaded', 'docker + a throwaway database'];
const REMOTE = ['plans waiting on your approval', 'the rules your team agreed on', 'every run, kept for later'];

function Box({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-rule-dark bg-surface-dark-raised p-3">
      <p className="font-mono text-[10.5px] tracking-[0.16em] text-term-dim uppercase">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[12px] leading-snug text-ink-dim">
            <span aria-hidden className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-punch-red" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MachineDiagram() {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <Box title="Your machine" lines={LOCAL} />

      <div className="grid grid-cols-2 gap-3 px-4">
        <div className="flex flex-col items-center gap-1">
          <span aria-hidden className="h-4 w-px bg-rule-dark" />
          <Icon name="arrowDown" size={12} className="text-term-dim" />
          <span className="font-mono text-[10px] tracking-[0.08em] text-term-dim">results up</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span aria-hidden className="h-4 w-px bg-rule-dark" />
          <Icon name="arrowUp" size={12} className="text-term-dim" />
          <span className="font-mono text-[10px] tracking-[0.08em] text-term-dim">plans down</span>
        </div>
      </div>

      <Box title="GritQA — this dashboard" lines={REMOTE} />

      <p className="mt-1 text-[11.5px] leading-snug text-term-dim">
        Two halves of one loop. The CLI does the work that needs your machine; the dashboard holds
        everything you need to look at.
      </p>
    </div>
  );
}

import { cn } from '@/lib/cn';

/**
 * Structured terminal output. Lines are typed data rather than pre-coloured
 * strings so timings right-align, glyphs stay consistent, and the whole block
 * can be described to assistive tech in one caption.
 */
export type TermLine =
  | { kind: 'cmd'; text: string }
  | { kind: 'ok'; text: string; meta?: string }
  | { kind: 'fail'; text: string; meta?: string }
  | { kind: 'info'; text: string; meta?: string }
  | { kind: 'out'; text: string; meta?: string }
  | { kind: 'tree'; text: string; meta?: string; last?: boolean; status?: 'pass' | 'fail' | 'skip' }
  | { kind: 'blank' };

const GLYPH = {
  ok: { mark: '✓', cls: 'text-term-pass' },
  fail: { mark: '✕', cls: 'text-term-fail' },
  pass: { mark: '✓', cls: 'text-term-pass' },
  skip: { mark: '–', cls: 'text-term-dim' },
} as const;

function Line({ line, delay }: { line: TermLine; delay: number }) {
  const style = { animationDelay: `${delay}ms` } as React.CSSProperties;
  const base = 'flex items-baseline gap-2 opacity-0 animate-line';

  if (line.kind === 'blank') return <div className="h-[1.15em]" />;

  if (line.kind === 'cmd') {
    return (
      <div className={base} style={style}>
        <span className="text-punch-red select-none">$</span>
        <span className="text-ink-inverse">{line.text}</span>
      </div>
    );
  }

  if (line.kind === 'tree') {
    const g = line.status ? GLYPH[line.status] : null;
    return (
      <div className={base} style={style}>
        <span className="text-rule-dark select-none">{line.last ? '└──' : '├──'}</span>
        <span className="text-ink-inverse/85">{line.text}</span>
        {g && <span className={cn('ml-auto shrink-0', g.cls)}>{g.mark}</span>}
        {line.meta && (
          <span className={cn('nums shrink-0 text-term-dim', !g && 'ml-auto')}>{line.meta}</span>
        )}
      </div>
    );
  }

  const tone =
    line.kind === 'ok' ? 'text-ink-inverse/85'
    : line.kind === 'fail' ? 'text-ink-inverse/85'
    : line.kind === 'info' ? 'text-term-dim'
    : 'text-ink-inverse/85';

  const g = line.kind === 'ok' ? GLYPH.ok : line.kind === 'fail' ? GLYPH.fail : null;

  return (
    <div className={base} style={style}>
      {g ? (
        <span className={cn('shrink-0 select-none', g.cls)}>{g.mark}</span>
      ) : (
        <span aria-hidden className="w-[1ch] shrink-0" />
      )}
      <span className={tone}>{line.text}</span>
      {line.meta && <span className="nums ml-auto shrink-0 text-term-dim">{line.meta}</span>}
    </div>
  );
}

export type TerminalProps = {
  lines: TermLine[];
  /** Mono label in the chrome bar. */
  title?: string;
  /** Right side of the chrome bar. */
  meta?: string;
  /** Footer metrics rail: [label, value] pairs. */
  stats?: { label: string; value: string; tone?: 'pass' | 'fail' | 'default' }[];
  /** Blinking caret after the last line. */
  caret?: boolean;
  /** Plain-language description for screen readers. */
  caption: string;
  /** Stagger step in ms. 0 renders fully visible. */
  stagger?: number;
  className?: string;
};

export function Terminal({
  lines,
  title = 'gritqa',
  meta,
  stats,
  caret = true,
  caption,
  stagger = 55,
  className,
}: TerminalProps) {
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-lg border border-rule-dark bg-surface-dark',
        'shadow-[0_1px_2px_rgba(27,29,46,0.1),0_24px_48px_-24px_rgba(27,29,46,0.35)]',
        className,
      )}
    >
      {/* Chrome — a spec label, not window furniture. */}
      <div className="flex items-center gap-2.5 border-b border-rule-dark px-4 py-2.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-term-pass" />
        <span className="font-mono text-[11px] tracking-[0.14em] text-ink-inverse uppercase">
          {title}
        </span>
        {meta && (
          <span className="nums ml-auto font-mono text-[11px] text-term-dim">{meta}</span>
        )}
      </div>

      {/* Body */}
      <div
        aria-hidden
        className="px-4 py-4 font-mono text-[12.5px] leading-[1.75] sm:px-5 sm:text-[13px]"
      >
        {lines.map((line, i) => (
          <Line key={i} line={line} delay={stagger * i} />
        ))}
        {caret && (
          <div
            className="flex items-baseline gap-2 opacity-0 animate-line"
            style={{ animationDelay: `${stagger * lines.length}ms` }}
          >
            <span className="text-punch-red select-none">$</span>
            <span className="animate-caret inline-block h-[1.05em] w-[0.5em] translate-y-[0.12em] bg-ink-inverse/70" />
          </div>
        )}
      </div>

      {/* Metrics rail */}
      {stats && stats.length > 0 && (
        <div
          aria-hidden
          className="grid divide-x divide-rule-dark border-t border-rule-dark"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-term-dim">
                {s.label}
              </div>
              <div
                className={cn(
                  'nums mt-1 font-mono text-sm',
                  s.tone === 'pass' ? 'text-term-pass'
                  : s.tone === 'fail' ? 'text-term-fail'
                  : 'text-ink-inverse',
                )}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

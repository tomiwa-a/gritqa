import { cn } from '@/lib/cn';

/* ── Eyebrow ──────────────────────────────────────────────────
   `plain` is the default — a red rule, an optional numeral, and a
   sentence-case label. Monospace is kept for things that really
   are code, so `mono` has to be asked for.                       */

export function Eyebrow({
  index,
  children,
  tone = 'light',
  variant = 'plain',
  className,
}: {
  index?: string;
  children: React.ReactNode;
  tone?: 'light' | 'dark';
  variant?: 'plain' | 'mono';
  className?: string;
}) {
  if (variant === 'mono') {
    return (
      <p
        className={cn(
          'flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em]',
          tone === 'dark' ? 'text-term-dim' : 'text-ink-subtle',
          className,
        )}
      >
        {index && (
          <>
            <span className={cn('nums', tone === 'dark' ? 'text-ink-inverse' : 'text-ink')}>
              {index}
            </span>
            <span aria-hidden className={cn('h-px w-6', tone === 'dark' ? 'bg-rule-dark' : 'bg-rule-strong')} />
          </>
        )}
        {children}
      </p>
    );
  }

  return (
    <p
      className={cn(
        'flex items-center gap-2.5 text-[13px] font-semibold',
        tone === 'dark' ? 'text-ink-inverse' : 'text-ink',
        className,
      )}
    >
      {index && <span className="nums text-punch-red">{index}</span>}
      <span aria-hidden className="h-px w-5 shrink-0 bg-punch-red" />
      {children}
    </p>
  );
}

/* ── Display / Heading ────────────────────────────────────────
   Four steps of display type. `accent` marks a single word in
   punch-red rather than tinting whole phrases.                  */

const DISPLAY = {
  xl: 'text-[2.75rem] sm:text-display-lg lg:text-display-xl',
  lg: 'text-display-md sm:text-display-lg',
  md: 'text-display-sm sm:text-display-md',
  sm: 'text-[1.375rem] sm:text-display-sm',
} as const;

export function Display({
  as: Tag = 'h2',
  size = 'lg',
  tone = 'light',
  children,
  className,
}: {
  as?: 'h1' | 'h2' | 'h3' | 'p';
  size?: keyof typeof DISPLAY;
  tone?: 'light' | 'dark';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        'font-heading font-semibold text-balance',
        DISPLAY[size],
        tone === 'dark' ? 'text-ink-inverse' : 'text-ink',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Single accented word inside a Display. */
export function Accent({ children }: { children: React.ReactNode }) {
  return <span className="text-punch-red">{children}</span>;
}

/* ── Lead / Prose ─────────────────────────────────────────── */

export function Lead({
  tone = 'light',
  children,
  className,
}: {
  tone?: 'light' | 'dark';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'max-w-[52ch] text-[1.0625rem] leading-[1.65] text-pretty sm:text-lg',
        tone === 'dark' ? 'text-term-dim' : 'text-ink-muted',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Prose({
  tone = 'light',
  children,
  className,
}: {
  tone?: 'light' | 'dark';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-[0.9375rem] leading-[1.7] text-pretty',
        tone === 'dark' ? 'text-term-dim' : 'text-ink-muted',
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ── SectionHead ──────────────────────────────────────────────
   Eyebrow + Display + Lead in one consistent block, so every
   section shares identical vertical rhythm.                     */

export function SectionHead({
  index,
  eyebrow,
  eyebrowVariant = 'plain',
  title,
  lead,
  tone = 'light',
  align = 'left',
  className,
}: {
  index?: string;
  eyebrow: string;
  eyebrowVariant?: 'plain' | 'mono';
  title: React.ReactNode;
  lead?: React.ReactNode;
  tone?: 'light' | 'dark';
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-5',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      <Eyebrow index={index} tone={tone} variant={eyebrowVariant}>
        {eyebrow}
      </Eyebrow>
      <Display size="md" tone={tone} className="max-w-[24ch]">
        {title}
      </Display>
      {lead && <Lead tone={tone}>{lead}</Lead>}
    </div>
  );
}

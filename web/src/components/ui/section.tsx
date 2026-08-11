import { cn } from '@/lib/cn';
import { Container } from './container';
import { Crosshair } from './crosshair';

type SectionProps = {
  children: React.ReactNode;
  id?: string;
  /** Surface tier. `dark` inverts for the technical/product moments. */
  tone?: 'light' | 'sunken' | 'dark';
  space?: 'sm' | 'md' | 'lg';
  /** Hairline across the top of the section. */
  divide?: boolean;
  /** Blueprint grid wash. */
  grid?: boolean;
  /** Vertical column rules + registration marks at the corners. */
  frame?: boolean;
  width?: 'wide' | 'prose';
  className?: string;
};

const TONE = {
  light: 'bg-surface text-ink',
  sunken: 'bg-surface-sunken text-ink',
  dark: 'bg-surface-dark text-ink-inverse',
} as const;

const SPACE = {
  sm: 'py-14 sm:py-20',
  md: 'py-20 sm:py-28',
  lg: 'py-24 sm:py-36',
} as const;

export function Section({
  children,
  id,
  tone = 'light',
  space = 'md',
  divide = false,
  grid = false,
  frame = false,
  width = 'wide',
  className,
}: SectionProps) {
  const dark = tone === 'dark';

  return (
    <section
      id={id}
      className={cn(
        'relative isolate',
        TONE[tone],
        SPACE[space],
        divide && (dark ? 'border-t border-rule-dark' : 'border-t border-rule'),
        className,
      )}
    >
      {grid && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 -z-10',
            dark ? 'bg-grid-dark opacity-40' : 'bg-grid opacity-60',
          )}
        />
      )}

      <Container width={width} rules={frame} tone={dark ? 'dark' : 'light'}>
        {frame && (
          <>
            <Crosshair at="tl" tone={dark ? 'dark' : 'light'} />
            <Crosshair at="tr" tone={dark ? 'dark' : 'light'} />
            <Crosshair at="bl" tone={dark ? 'dark' : 'light'} />
            <Crosshair at="br" tone={dark ? 'dark' : 'light'} />
          </>
        )}
        {children}
      </Container>
    </section>
  );
}

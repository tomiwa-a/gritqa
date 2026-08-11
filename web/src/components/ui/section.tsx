import { cn } from '@/lib/cn';
import { Container } from './container';
import { Crosshair } from './crosshair';

type SectionProps = {
  children: React.ReactNode;
  id?: string;
  tone?: 'light' | 'sunken' | 'dark';
  space?: 'sm' | 'md' | 'lg';
  divide?: boolean;
  grid?: boolean;
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
  sm: 'py-12 sm:py-16 lg:py-20',
  md: 'py-16 sm:py-22 lg:py-28',
  lg: 'py-20 sm:py-28 lg:py-36',
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
        'relative isolate overflow-x-clip',
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
            dark ? 'bg-grid-dark opacity-25' : 'bg-grid opacity-60',
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

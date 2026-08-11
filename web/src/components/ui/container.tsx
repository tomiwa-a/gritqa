import { cn } from '@/lib/cn';

type ContainerProps = {
  children: React.ReactNode;
  width?: 'wide' | 'prose';
  rules?: boolean;
  tone?: 'light' | 'dark';
  className?: string;
};

export function Container({
  children,
  width = 'wide',
  rules = false,
  tone = 'light',
  className,
}: ContainerProps) {
  const edge = tone === 'dark' ? 'border-rule-dark' : 'border-rule';

  return (
    <div
      className={cn(
        'relative mx-auto w-full px-6 sm:px-8',
        width === 'wide' ? 'max-w-[1200px]' : 'max-w-[720px]',
        rules && cn('border-x', edge),
        className,
      )}
    >
      {children}
    </div>
  );
}

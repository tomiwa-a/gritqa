import { cn } from '@/lib/cn';

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('mx-auto w-full max-w-[1360px] px-4 py-5 sm:px-6 sm:py-6', className)}>
      {children}
    </main>
  );
}

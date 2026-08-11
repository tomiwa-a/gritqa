import { cn } from '@/lib/cn';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHOD: Record<Method, string> = {
  GET: 'text-[#1d4ed8] bg-[#eaf0fe]',
  POST: 'text-pass bg-pass-soft',
  PUT: 'text-warn bg-warn-soft',
  PATCH: 'text-warn bg-warn-soft',
  DELETE: 'text-fail bg-fail-soft',
};

const METHOD_DARK: Record<Method, string> = {
  GET: 'text-[#93b4fd]',
  POST: 'text-term-pass',
  PUT: 'text-term-warn',
  PATCH: 'text-term-warn',
  DELETE: 'text-term-fail',
};

export function MethodBadge({
  method,
  tone = 'light',
  className,
}: {
  method: Method;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-[3.75rem] shrink-0 items-center justify-center rounded',
        'font-mono text-[10px] font-semibold tracking-[0.08em]',
        tone === 'dark' ? cn('bg-surface-dark-raised', METHOD_DARK[method]) : METHOD[method],
        className,
      )}
    >
      {method}
    </span>
  );
}

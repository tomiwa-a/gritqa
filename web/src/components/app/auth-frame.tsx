import { Wordmark } from '@/components/ui/wordmark';

export function AuthFrame({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <main
      id="main"
      className="flex min-h-screen flex-col items-center justify-center bg-app bg-grid px-4 py-12"
    >
      <div className="w-full max-w-[452px]">
        <div className="flex justify-center">
          <Wordmark />
        </div>
        <div className="mt-5 rounded-xl border border-rule bg-app-panel p-6 shadow-panel">
          {children}
        </div>
        {note && (
          <p className="mt-4 text-center text-[11.5px] leading-snug text-ink-subtle">{note}</p>
        )}
      </div>
    </main>
  );
}

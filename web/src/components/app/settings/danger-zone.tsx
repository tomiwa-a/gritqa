import { Icon } from '@/components/ui/icon';

export function DangerZone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-fail/25 bg-app-panel">
      <header className="flex items-center gap-2 border-b border-fail/20 bg-fail-soft/50 px-4 py-3">
        <Icon name="alert" size={14} className="text-fail" />
        <h3 className="text-[13.5px] font-medium text-ink">{title}</h3>
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

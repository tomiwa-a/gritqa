import { Segmented } from '@/components/ui/segmented';

export type ViewKey = 'all' | 'review' | 'failing';

const VIEWS: { key: ViewKey; label: string; dot?: string }[] = [
  { key: 'all', label: 'All work' },
  { key: 'review', label: 'Needs review' },
  { key: 'failing', label: 'Failing', dot: 'bg-fail' },
];

export function ViewFilter({
  active,
  counts,
}: {
  active: ViewKey;
  counts: Record<ViewKey, number>;
}) {
  return (
    <Segmented
      label="Filter the work list"
      active={active}
      options={VIEWS.map((v) => ({
        key: v.key,
        label: v.label,
        dot: v.dot,
        count: counts[v.key],
        href: v.key === 'all' ? '/dashboard#work' : `/dashboard?view=${v.key}#work`,
      }))}
    />
  );
}

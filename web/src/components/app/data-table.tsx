import { cn } from '@/lib/cn';

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  hideHeader?: boolean;
  cellClassName?: string;
  headerClassName?: string;
  cell: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  minWidth = 720,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  minWidth?: number;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) return <div className="p-4">{empty}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'border-b border-rule-soft bg-app px-4 py-2 text-[10.5px] font-medium tracking-[0.06em] text-ink-subtle uppercase',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.headerClassName,
                )}
              >
                {c.hideHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-rule-soft transition-colors duration-150 last:border-b-0 hover:bg-app-hover"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-4 py-3 align-middle',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    c.cellClassName,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

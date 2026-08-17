import { cn } from '@/lib/cn';

function highlightYaml(line: string, i: number) {
  if (/^\s*#/.test(line)) {
    return <span className="text-term-dim italic">{line}</span>;
  }

  const m = line.match(/^(\s*)(-\s*)?([\w.$-]+)(:)(.*)$/);
  if (!m) return <span className="text-ink-inverse/80">{line}</span>;

  const [, indent, dash, key, colon, rest] = m;
  return (
    <>
      <span>{indent}</span>
      {dash && <span className="text-rule-dark">{dash}</span>}
      <span className="text-[#93b4fd]">{key}</span>
      <span className="text-term-dim">{colon}</span>
      <span key={i} className="text-ink-inverse/80">
        {rest.replace(/"([^"]*)"/g, '"$1"')}
      </span>
    </>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?)/g;

function highlightJson(line: string) {
  const out: React.ReactNode[] = [];
  let at = 0;

  for (const m of line.matchAll(JSON_TOKEN)) {
    const start = m.index ?? 0;
    if (start > at) out.push(<span key={`p${at}`}>{line.slice(at, start)}</span>);

    const tone = m[1]
      ? 'text-[#93b4fd]'
      : m[2]
        ? 'text-ink-inverse/80'
        : m[3]
          ? 'text-[#e0a3f5]'
          : 'text-[#8ad7b8]';

    out.push(
      <span key={`t${start}`} className={tone}>
        {m[0]}
      </span>,
    );
    at = start + m[0].length;
  }

  if (at < line.length) out.push(<span key={`p${at}`}>{line.slice(at)}</span>);
  return <span className="text-term-dim">{out}</span>;
}

export function CodeBlock({
  code,
  filename,
  lang = 'yaml',
  lineNumbers = true,
  caption,
  className,
}: {
  code: string;
  filename?: string;
  lang?: 'yaml' | 'bash' | 'text' | 'json';
  lineNumbers?: boolean;
  caption: string;
  className?: string;
}) {
  const lines = code.replace(/\n$/, '').split('\n');
  const gutter = String(lines.length).length;

  return (
    <figure
      className={cn(
        'overflow-hidden rounded-lg border border-rule-dark bg-surface-dark',
        'shadow-[0_1px_2px_rgba(27,29,46,0.1),0_20px_44px_-26px_rgba(27,29,46,0.3)]',
        className,
      )}
    >
      {filename && (
        <div className="flex items-center gap-3 border-b border-rule-dark px-4 py-2.5">
          <span className="font-mono text-[11px] text-ink-inverse">{filename}</span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-term-dim">
            {lang}
          </span>
        </div>
      )}

      <pre aria-hidden className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.75]">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {lineNumbers && (
                <span
                  className="nums mr-4 shrink-0 select-none text-right text-rule-dark"
                  style={{ width: `${gutter}ch` }}
                >
                  {i + 1}
                </span>
              )}
              <span className="min-w-0 whitespace-pre">
                {lang === 'yaml' ? (
                  highlightYaml(line, i)
                ) : lang === 'json' ? (
                  highlightJson(line)
                ) : (
                  <span className="text-ink-inverse/80">{line}</span>
                )}
              </span>
            </div>
          ))}
        </code>
      </pre>

      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

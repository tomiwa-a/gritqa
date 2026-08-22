import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlight, langOf } from '@/lib/highlight';
import { cn } from '@/lib/cn';

/**
 * Everything a model writes, rendered as what it wrote.
 *
 * The agent has always answered in markdown -- headings, bold, backticks, fenced
 * code, nested lists -- and every surface that displayed it printed the asterisks.
 * Which is worse than it sounds: the one audience this product is for is the person
 * who cannot read the code, and they were being handed an answer with the formatting
 * still in the text and a PHP snippet in the same grey as the sentence around it.
 *
 * A parser rather than a hand-rolled one, which is the one dependency in the app's
 * UI and worth naming why. The subset a model emits is not small -- three levels of
 * nested list under a numbered item, in the second answer anyone asked -- and the
 * failures of a regex renderer are the kind that eat a sentence rather than the kind
 * that look wrong. `remark` has been getting emphasis edge cases right for a decade.
 * What is hand-rolled is the part that would have shipped somebody else's design:
 * see `lib/highlight.tsx` for the six colours.
 *
 * Raw HTML is not enabled, so a model that writes a tag gets a rendered tag as text
 * rather than an element. That is deliberate and it is the whole sanitisation story:
 * there is no `rehype-raw` here to remove later.
 *
 * Sizes are set once on the wrapper and everything inside is relative to it, so the
 * same component reads correctly in a 380px drawer and on a full page.
 */

const SIZE = {
  /** Beside other panel copy: previews, revision summaries, step descriptions. */
  sm: 'text-[12.5px]',
  /** The thing on the page you came to read. */
  md: 'text-[13px]',
  /** A long answer with the room to be one. */
  lg: 'text-[13.5px]',
} as const;

/**
 * A fenced block, coloured, with the language named when the model named one.
 *
 * Exported because a plan's own text is not markdown and must not be treated as
 * though it were: a statement or a command is a literal, and wrapping one in
 * backticks to hand it to the parser above would let a `#` or an underscore inside
 * it change how it reads. The step inspector shows exactly what will run, so it
 * names the language itself and comes straight here.
 */
export function Fence({ code, tag }: { code: string; tag: string | undefined }) {
  const lang = langOf(tag);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-rule-dark bg-surface-dark first:mt-0">
      {lang !== 'text' && (
        <div className="border-b border-rule-dark px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-term-dim uppercase">
          {lang}
        </div>
      )}
      <pre className="px-3 py-2.5 font-mono text-[0.9em] leading-[1.7]">
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

/**
 * The element map. Every entry exists to replace a browser default with a house
 * token, which is why there is no stylesheet and no `prose` class doing it from
 * outside -- the same reason the icon set is hand-drawn.
 */
const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mt-2.5 leading-relaxed [overflow-wrap:anywhere] first:mt-0">{children}</p>
  ),

  /* Three heading levels, because a model uses them for weight rather than for
     outline depth, and an answer that jumped two type sizes would read as two
     documents. */
  h1: ({ children }) => (
    <h3 className="mt-4 text-[1.08em] font-medium text-ink first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 text-[1.04em] font-medium text-ink first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => <h4 className="mt-3.5 font-medium text-ink first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 font-medium text-ink first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-3 font-medium text-ink first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-3 font-medium text-ink first:mt-0">{children}</h6>,

  /* Bold darkens rather than thickens. The body of an answer sits in `ink-muted`, so
     moving to full `ink` is a stronger signal than weight alone and does not make a
     paragraph look like it is shouting. */
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-subtle line-through">{children}</del>,

  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-ink underline decoration-rule-strong underline-offset-2 transition-colors duration-150 hover:decoration-ink"
    >
      {children}
    </a>
  ),

  ul: ({ children }) => (
    <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 marker:text-ink-subtle first:mt-0">
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol
      start={start}
      className="nums mt-2 flex list-decimal flex-col gap-1 pl-4.5 marker:text-ink-subtle first:mt-0"
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 leading-relaxed [overflow-wrap:anywhere]">{children}</li>
  ),

  blockquote: ({ children }) => (
    <blockquote className="mt-2.5 border-l-2 border-rule-strong pl-3 text-ink-subtle first:mt-0">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-3.5 border-0 border-t border-rule-soft" />,

  /* Scrolls inside itself. A wide table in a drawer must not make the drawer wide. */
  table: ({ children }) => (
    <div className="-mx-1 mt-3 max-w-full overflow-x-auto px-1 first:mt-0">
      <table className="w-full border-collapse text-[0.94em]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-rule px-2 py-1.5 text-left font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-rule-soft px-2 py-1.5 align-top">{children}</td>
  ),

  /**
   * The fence, read off the tree rather than guessed from a class name.
   *
   * `passNode` is always on, so the `<code>` inside is right here with its language
   * and its text -- which is what makes the block/inline split exact instead of the
   * usual "does the class say `language-`" heuristic that renders an unlabelled fence
   * as inline code.
   */
  pre: ({ children, node }) => {
    const child = node?.children?.[0];
    if (!child || child.type !== 'element' || child.tagName !== 'code') {
      return <pre className="mt-3 first:mt-0">{children}</pre>;
    }

    const classes = child.properties?.className;
    const tag = (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith('language-'))
      ?.slice('language-'.length);

    const code = child.children.map((part) => (part.type === 'text' ? part.value : '')).join('');
    return <Fence code={code} tag={tag} />;
  },

  /* Only ever inline: `pre` above does not render its children through here. */
  code: ({ children }) => (
    <code className="rounded border border-rule bg-app px-1 py-px font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">
      {children}
    </code>
  ),
};

export function Prose({
  children,
  size = 'sm',
  className,
}: {
  /** The markdown itself. Empty or whitespace renders nothing at all. */
  children: string | null | undefined;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  if (!children?.trim()) return null;

  return (
    <div className={cn(SIZE[size], 'text-ink-muted', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}

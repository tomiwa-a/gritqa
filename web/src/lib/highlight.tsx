import type { ReactNode } from 'react';

/**
 * Colour for code the model quoted, without knowing what language it is.
 *
 * The first version of this had keyword tables -- every PHP keyword, every SQL
 * keyword, every JS keyword -- and that is a losing shape. It is wrong the day
 * somebody asks about a Python service, it is wrong about the words it does have the
 * moment a language adds one, and the size of it implies a precision it does not
 * have. So there are no words in here.
 *
 * What is left is the structure every language shares, which turns out to be most of
 * what makes code readable at a glance: what is quoted, what is a comment, what is a
 * number, what is being called, what is standing in for a value later, and what is
 * punctuation holding it together. Six rules, no vocabulary, nothing to rot.
 *
 * The one concession to looking like a highlighter is that a SCREAMING_CASE run gets
 * the keyword tone. That is still structural -- upper case is a decision somebody
 * made about the identifier -- and it happens to catch `SELECT ... FROM` in SQL and
 * constants everywhere else.
 *
 * Honest about its other limit: it works one line at a time, so a string or a comment
 * that runs across a newline loses its colour on the second line.
 */

const TONE = {
  /** Comments, and the punctuation between everything else. */
  dim: 'text-term-dim',
  /** Upper case: SQL's verbs, and constants. */
  keyword: 'text-[#e0a3f5]',
  /** A name being used: called as a function, or read as a key. */
  name: 'text-[#93b4fd]',
  /** Anything quoted. */
  string: 'text-[#8ad7b8]',
  /** Numbers. */
  number: 'text-[#f2c078]',
  /** Standing in for a value: `$var`, `${NAME}`, `:param`. */
  slot: 'text-[#f6a3b8]',
} as const;

type Tone = keyof typeof TONE;

/**
 * Ordered, and the order is the whole of the logic: the first rule to match a
 * position wins, so a `#` inside a string has to be reached by the string rule
 * before the comment rule sees it.
 */
const RULES: [Tone, string][] = [
  /* Four comment openers, which is every one in common use. `--` needs the space or
     it would eat a decrement, and `#` is a comment in shell, PHP, Python, YAML and
     Ruby -- more languages than it is anything else in. */
  ['dim', String.raw`//[^\n]*|#[^\n]*|--\s[^\n]*|/\*.*?\*/`],

  /* Three quote characters, each allowing an escaped copy of itself. SQL's doubled
     `''` is handled by the single-quote branch running on. */
  ['string', String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|` + '`(?:\\\\.|[^`\\\\])*`'],

  /* Something whose value arrives later: a PHP or shell variable, an interpolation,
     a bound SQL parameter. Named `slot` rather than `variable` because that is what
     they have in common. */
  ['slot', String.raw`\$\{[^}\n]*\}|\$[A-Za-z_]\w*|[:@][A-Za-z_]\w*(?=\s|,|\)|$)`],

  ['number', String.raw`\b\d[\d_]*(?:\.\d+)?\b`],

  /* Upper case with at least two characters, so `I` and a lone `A` stay text. */
  ['keyword', String.raw`\b[A-Z][A-Z0-9_]+\b`],

  /* A name in use: immediately before a paren it is being called, immediately before
     a colon it is a key. Both hold in every language that has either. */
  ['name', String.raw`\b[A-Za-z_]\w*(?=\s*\()|"[^"\n]*"(?=\s*:)|\b[A-Za-z_][\w.-]*(?=\s*:)`],

  ['dim', String.raw`->|=>|::|\|\||&&|[{}()[\];,.:=<>!+\-*/%&|^?~@]`],
];

/**
 * What the model wrote after the backticks.
 *
 * Only two answers matter to the colouring -- a diff is coloured by line, everything
 * else by token -- but the tag is kept and normalised because it is also the label
 * printed above the block, and `postgresql` should read as `sql` there.
 */
export function langOf(tag: string | undefined): string {
  const key = (tag ?? '').toLowerCase().trim();
  if (!key) return 'text';
  if (/^(diff|patch)$/.test(key)) return 'diff';
  if (/^(sql|mysql|postgres|postgresql|psql|sqlite|pgsql)$/.test(key)) return 'sql';
  if (/^(sh|zsh|shell|console|terminal|cmd)$/.test(key)) return 'bash';
  if (/^(js|javascript|node)$/.test(key)) return 'js';
  if (/^(ts|typescript)$/.test(key)) return 'ts';
  if (/^(yml|yaml)$/.test(key)) return 'yaml';
  if (/^(https?|rest|curl)$/.test(key)) return 'http';
  /* Anything else is shown as the model wrote it, trimmed to something that cannot
     be mistaken for a sentence in the label. */
  return /^[\w+#.-]{1,12}$/.test(key) ? key : 'text';
}

/* Built once. Every rule is one capturing group, so the group that matched names the
   tone -- which is why every group inside a rule above is `(?:...)`. */
const PATTERN = new RegExp(RULES.map(([, src]) => `(${src})`).join('|'), 'g');
const TONES = RULES.map(([tone]) => tone);

/** A diff is coloured by which side of it a line is on, and by nothing else. */
function diffLine(line: string): ReactNode {
  if (/^@@/.test(line)) return <span className={TONE.name}>{line}</span>;
  if (/^\+/.test(line)) return <span className="text-term-pass">{line}</span>;
  if (/^-/.test(line)) return <span className="text-term-fail">{line}</span>;
  return <span className="text-ink-inverse/85">{line}</span>;
}

function tokens(line: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;

  for (const match of line.matchAll(PATTERN)) {
    const start = match.index;
    if (start > at) {
      out.push(
        <span key={`t${at}`} className="text-ink-inverse/85">
          {line.slice(at, start)}
        </span>,
      );
    }

    /* Exactly one group is defined, and which one is the tone. */
    const group = match.slice(1).findIndex((value) => value !== undefined);
    out.push(
      <span key={`m${start}`} className={TONE[TONES[group] ?? 'dim']}>
        {match[0]}
      </span>,
    );
    at = start + match[0].length;
  }

  if (at < line.length) {
    out.push(
      <span key={`t${at}`} className="text-ink-inverse/85">
        {line.slice(at)}
      </span>,
    );
  }

  return out;
}

/**
 * The code, line by line, coloured.
 *
 * Lines are separate elements rather than one blob because a wrapped line in an
 * answer still has to be readable in a narrow panel: each one wraps within itself
 * and keeps its own indentation, which a single `white-space: pre` block does not do.
 */
export function highlight(code: string, lang: string): ReactNode[] {
  return code
    .replace(/\n+$/, '')
    .split('\n')
    .map((line, i) => (
      <span key={i} className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
        {line === '' ? ' ' : lang === 'diff' ? diffLine(line) : tokens(line)}
      </span>
    ));
}

import { Container } from '@/components/ui/container';
import { Wordmark } from '@/components/ui/wordmark';

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Spec', href: '#spec' },
      { label: 'Join waitlist', href: '#waitlist' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Plan format', href: '/docs/plan-format' },
      { label: 'CI setup', href: '/docs/ci' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'GitHub', href: 'https://github.com/gritqa' },
      { label: 'Issues', href: 'https://github.com/gritqa/gritqa/issues' },
      { label: 'Contact', href: 'mailto:hello@gritqa.dev' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-rule bg-surface">
      <Container rules>
        <div className="grid gap-x-10 gap-y-12 py-14 lg:grid-cols-12 lg:py-16">
          {/* Identity */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <Wordmark />
            <p className="max-w-[34ch] text-[13.5px] leading-[1.65] text-ink-muted">
              Integration tests generated from the backend code you already wrote.
              One command, plain YAML, no agents.
            </p>
          </div>

          {/* Link columns */}
          <nav aria-label="Footer" className="grid gap-x-8 gap-y-10 sm:grid-cols-3 lg:col-span-7">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <h2 className="font-mono text-[10.5px] tracking-[0.18em] text-ink-subtle uppercase">
                  {col.heading}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        className="text-[13.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom rail */}
        <div className="flex flex-col gap-3 border-t border-rule py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-subtle">
            © {new Date().getFullYear()} GritQA. All rights reserved.
          </p>
          <p className="nums font-mono text-[10.5px] tracking-[0.16em] text-ink-subtle uppercase">
            v0.1.0 · pre-release
          </p>
        </div>
      </Container>
    </footer>
  );
}

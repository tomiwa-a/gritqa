import { Container } from '@/components/ui/container';
import { Wordmark } from '@/components/ui/wordmark';

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'What you get', href: '/#product' },
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Test types', href: '/#coverage' },
      { label: 'Who it’s for', href: '/#who-its-for' },
      { label: 'Get early access', href: '/#waitlist' },
    ],
  },
  {
    heading: 'Account',
    links: [{ label: 'Sign in', href: '/login' }],
  },
  {
    heading: 'Contact',
    links: [{ label: 'hello@gritqa.dev', href: 'mailto:hello@gritqa.dev' }],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-rule bg-surface">
      <Container rules>
        <div className="grid gap-x-10 gap-y-12 py-14 lg:grid-cols-12 lg:py-16">
          <div className="flex flex-col gap-4 lg:col-span-5">
            <Wordmark />
            <p className="max-w-[34ch] text-[13.5px] leading-[1.65] text-ink-muted">
              Backend tests that get written for you, approved by you, and run
              against a real database on your own machine.
            </p>
          </div>

          <nav aria-label="Footer" className="grid gap-x-8 gap-y-10 sm:grid-cols-3 lg:col-span-7">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <h2 className="text-[13px] font-semibold text-ink">{col.heading}</h2>
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

        <div className="flex flex-col gap-3 border-t border-rule py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-ink-subtle">
            © {new Date().getFullYear()} GritQA. All rights reserved.
          </p>
          <p className="text-[12.5px] text-ink-subtle">Private beta</p>
        </div>
      </Container>
    </footer>
  );
}

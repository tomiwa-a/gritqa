'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Container } from '@/components/ui/container';
import { Button, ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/wordmark';

const LINKS = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#spec', label: 'Spec' },
  { href: '/docs', label: 'Docs' },
];

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="h-4 w-4">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock the page and wire Escape only while the mobile panel is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b bg-surface/85 backdrop-blur-md',
        'transition-colors duration-200',
        scrolled ? 'border-rule' : 'border-transparent',
      )}
    >
      <Container>
        <div className="flex h-16 items-center gap-8">
          <div className="flex items-baseline gap-2.5">
            <Wordmark />
            <span className="nums hidden font-mono text-[10px] tracking-[0.14em] text-ink-subtle sm:inline">
              v0.1.0
            </span>
          </div>

          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-7">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-[13.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ButtonLink
              href="https://github.com/gritqa"
              variant="ghost"
              size="sm"
              className="hidden gap-2 sm:inline-flex"
            >
              <GithubMark />
              <span className="nums font-mono text-[11px]">1.2k</span>
            </ButtonLink>

            <ButtonLink href="#waitlist" variant="primary" size="sm" className="hidden sm:inline-flex">
              Join waitlist
            </ButtonLink>

            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((v) => !v)}
            >
              <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
              <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                {open ? (
                  <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
                ) : (
                  <path d="M2 5h12M2 11h12" strokeLinecap="round" />
                )}
              </svg>
            </Button>
          </div>
        </div>
      </Container>

      {/* Mobile panel */}
      {open && (
        <div id="mobile-nav" className="border-t border-rule bg-surface md:hidden">
          <Container>
            <nav aria-label="Main" className="py-4">
              <ul className="flex flex-col">
                {LINKS.map((l) => (
                  <li key={l.href} className="border-b border-rule last:border-0">
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="block py-3 text-[15px] text-ink-muted transition-colors hover:text-ink"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <ButtonLink
                href="#waitlist"
                variant="primary"
                size="md"
                trailing
                onClick={() => setOpen(false)}
                className="mt-4 w-full"
              >
                Join waitlist
              </ButtonLink>
            </nav>
          </Container>
        </div>
      )}
    </header>
  );
}

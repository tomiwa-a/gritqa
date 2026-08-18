'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { lockScroll } from '@/lib/scroll-lock';
import { Container } from '@/components/ui/container';
import { Button, ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/wordmark';

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#coverage', label: 'Test types' },
  { href: '#who-its-for', label: 'Who it’s for' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const releaseScroll = lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseScroll();
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
          <Wordmark />

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
            <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Sign in
            </ButtonLink>

            <ButtonLink
              href="#waitlist"
              variant="primary"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Get early access
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
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
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
                Get early access
              </ButtonLink>
              <ButtonLink
                href="/login"
                variant="ghost"
                size="md"
                onClick={() => setOpen(false)}
                className="mt-2 w-full"
              >
                Sign in
              </ButtonLink>
            </nav>
          </Container>
        </div>
      )}
    </header>
  );
}

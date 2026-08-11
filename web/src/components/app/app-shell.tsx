'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { Sidebar } from './sidebar';

const ShellContext = createContext<{ openMobileNav: () => void } | null>(null);

export function useAppShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useAppShell must be used inside AppShell');
  return ctx;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <ShellContext.Provider value={{ openMobileNav: () => setMobileOpen(true) }}>
      <div className="flex min-h-screen bg-app">
        <div className="sticky top-0 hidden h-screen shrink-0 lg:block">
          <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
        </div>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-ink/25"
            />
            <div className="absolute inset-y-0 left-0 shadow-menu">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}

export function MobileNavTrigger() {
  const { openMobileNav } = useAppShell();
  return (
    <button
      type="button"
      onClick={openMobileNav}
      aria-label="Open navigation"
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-app-hover hover:text-ink lg:hidden"
    >
      <Icon name="panel" size={16} />
    </button>
  );
}

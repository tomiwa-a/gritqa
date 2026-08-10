'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Folder, FileText, Shield, Settings, Menu, X, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const sections = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/projects', label: 'Projects', icon: Folder, badge: 6 },
      { href: '/dashboard/test-plans', label: 'Test Plans', icon: FileText, badge: 4 },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/dashboard/rules', label: 'Rules', icon: Shield },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    Workspace: true,
    Configuration: true,
  });

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const nav = (
    <div className="flex flex-col h-full bg-white border-r border-lavender-grey/10 w-60">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-lavender-grey/10">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-space-indigo flex items-center justify-center">
            <span className="text-white text-xs font-bold">G</span>
          </div>
          <span className="text-base font-bold text-space-indigo">GritQA</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            <button
              onClick={() => toggleSection(section.label)}
              className="flex items-center justify-between w-full px-2 py-1.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider hover:text-space-indigo transition-colors"
            >
              {section.label}
              <ChevronDown className={`h-3 w-3 transition-transform ${
                expandedSections[section.label] ? '' : '-rotate-90'
              }`} />
            </button>
            {expandedSections[section.label] && (
              <div className="mt-0.5 space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-platinum text-space-indigo font-medium'
                          : 'text-lavender-grey hover:text-space-indigo hover:bg-platinum/50'
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="text-[11px] font-medium text-lavender-grey">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-2 py-3 border-t border-lavender-grey/10">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-platinum transition-colors cursor-pointer">
          <div className="h-7 w-7 rounded-full bg-space-indigo/10 flex items-center justify-center text-xs font-bold text-space-indigo">
            D
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-space-indigo truncate">Demo User</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-50 lg:hidden flex items-center justify-center h-9 w-9 rounded-lg bg-white border border-lavender-grey/15 text-space-indigo"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              {nav}
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-3 right-3 text-lavender-grey hover:text-space-indigo"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        {nav}
      </div>
    </>
  );
}
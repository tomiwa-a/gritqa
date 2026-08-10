'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Folder, FileText, Shield, Settings, Menu, X } from 'lucide-react';
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

  const nav = (
    <div className="flex flex-col h-full bg-white border-r border-lavender-grey/15 w-64">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-lavender-grey/15">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="text-space-indigo">Grit</span>
          <span className="text-punch-red">QA</span>
        </Link>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="mb-6">
            <p className="px-3 mb-2 text-xs font-semibold text-lavender-grey uppercase tracking-wider">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-space-indigo/5 text-space-indigo'
                        : 'text-lavender-grey hover:text-space-indigo hover:bg-platinum'
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-punch-red/10 text-punch-red">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-lavender-grey/15">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-platinum transition-colors cursor-pointer">
          <div className="h-8 w-8 rounded-full bg-space-indigo/10 flex items-center justify-center text-sm font-bold text-space-indigo">
            D
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-space-indigo truncate">Demo User</p>
            <p className="text-xs text-lavender-grey truncate">demo@gritqa.dev</p>
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
        className="fixed top-4 left-4 z-50 lg:hidden flex items-center justify-center h-10 w-10 rounded-lg bg-white border border-lavender-grey/20 text-space-indigo shadow-sm"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -256 }}
              animate={{ x: 0 }}
              exit={{ x: -256 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              {nav}
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 text-lavender-grey hover:text-space-indigo"
              >
                <X className="h-5 w-5" />
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
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Folder, FileText, Shield, Settings, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const navItems = [
  { href: '/dashboard/projects', label: 'Projects', icon: Folder },
  { href: '/dashboard/test-plans', label: 'Test Plans', icon: FileText },
  { href: '/dashboard/rules', label: 'Rules', icon: Shield },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <div className="flex flex-col h-full bg-space-indigo text-white w-64">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="text-white">Grit</span>
          <span className="text-punch-red">QA</span>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-punch-red/20 flex items-center justify-center text-sm font-bold text-punch-red">
            D
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">Demo User</p>
            <p className="text-xs text-white/40 truncate">demo@gritqa.dev</p>
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
        className="fixed top-4 left-4 z-50 lg:hidden flex items-center justify-center h-10 w-10 rounded-lg bg-space-indigo text-white shadow-md"
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
                className="absolute top-4 right-4 text-white/60 hover:text-white"
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
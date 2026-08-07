'use client';

import Link from "next/link";
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 bg-platinum/80 backdrop-blur-md border-b border-lavender-grey/20">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="text-space-indigo">Grit</span>
          <span className="text-punch-red">QA</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm font-medium text-lavender-grey hover:text-space-indigo transition-colors">
            Features
          </a>
          <a href="#how-it-works" className="text-sm font-medium text-lavender-grey hover:text-space-indigo transition-colors">
            How It Works
          </a>
          <a href="#" className="text-sm font-medium text-lavender-grey hover:text-space-indigo transition-colors">
            Docs
          </a>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="#"
            className="hidden sm:flex items-center gap-2 border border-lavender-grey/30 rounded-full px-3 py-1.5 text-lavender-grey hover:text-space-indigo hover:border-lavender-grey/50 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="text-sm font-medium">1.2K</span>
          </a>

          <motion.a
            href="#"
            className="flex items-center gap-1.5 bg-punch-red text-platinum rounded-full px-5 py-2 text-sm font-semibold hover:bg-classic-crimson transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Join Waitlist
            <ArrowRight className="h-4 w-4" />
          </motion.a>
        </div>
      </div>
    </nav>
  );
}
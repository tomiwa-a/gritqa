'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const terminalLines = [
  { color: 'text-lavender-grey', text: '$ gritqa' },
  { color: 'text-green-600', text: '✓  Indexing codebase...  (1,247 files)' },
  { color: 'text-green-600', text: '✓  Detected 3 changed files' },
  { color: 'text-green-600', text: '✓  Generating test plan...' },
  { color: '', text: '' },
  { color: 'text-lavender-grey font-semibold', text: 'Test Plan: E2E Order Flow' },
  { color: '', text: '  ├── Step 1: Login           (POST /auth/login)     ✓ PASS  245ms' },
  { color: '', text: '  ├── Step 2: Create Order    (POST /orders)        ✓ PASS  512ms' },
  { color: '', text: '  ├── Step 3: Verify          (GET  /orders/:id)     ✓ PASS  189ms' },
  { color: '', text: '  └── Step 4: Cleanup         (DELETE /orders/:id)   ✓ PASS   67ms' },
  { color: '', text: '' },
  { color: 'text-lavender-grey', text: '  4/4 passed  ·  1.2s  ·  0 failed' },
];

export default function Hero() {
  return (
    <section className="bg-platinum pt-24 pb-20 md:pt-36 md:pb-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left */}
          <div className="max-w-xl">
            <motion.div
              className="inline-flex items-center px-4 py-2 rounded-full border border-lavender-grey/30 bg-white text-sm font-medium text-lavender-grey mb-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              Built for backend engineering teams
            </motion.div>

            <motion.h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] text-space-indigo"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              QA that{' '}
              <span className="text-punch-red">reads your codebase</span>.
            </motion.h1>

            <motion.p
              className="mt-6 text-lg md:text-xl text-lavender-grey leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              GritQA indexes your code, helps you build structured test plans,
              mocks every dependency, and keeps you in control — all on your
              machine.
            </motion.p>

            <motion.div
              className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <motion.button
                className="flex items-center gap-2 px-8 py-4 bg-punch-red text-platinum rounded-xl text-sm font-semibold hover:bg-classic-crimson transition-colors shadow-sm shadow-punch-red/20"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Start Testing Free
                <ArrowRight className="h-4 w-4" />
              </motion.button>
              <motion.button
                className="flex items-center gap-2 px-8 py-4 border border-lavender-grey/30 text-space-indigo rounded-xl text-sm font-semibold hover:bg-lavender-grey/10 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                View Docs
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </motion.div>
          </div>

          {/* Right — Terminal */}
          <motion.div
            className="relative mx-auto lg:mx-0 w-full max-w-lg lg:max-w-none"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <div className="rounded-2xl border border-lavender-grey/30 bg-white overflow-hidden shadow-lg shadow-space-indigo/5">
              <div className="px-4 py-3 border-b border-lavender-grey/20 bg-platinum flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-lavender-grey font-mono">bash</span>
              </div>
              <div className="px-5 py-5 font-mono text-sm leading-relaxed">
                {terminalLines.map((line, i) => (
                  <motion.div
                    key={i}
                    className={line.color || 'text-space-indigo'}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.5 + i * 0.08 }}
                  >
                    {line.text || '\u00A0'}
                  </motion.div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-lavender-grey/20 bg-platinum flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-xs text-lavender-grey font-mono">gritqa v0.1.0</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
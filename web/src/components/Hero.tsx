'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Search, FileText, Play, Eye, Check } from 'lucide-react';

const phases = [
  { icon: Search, label: 'Index', desc: 'AST parse' },
  { icon: FileText, label: 'Plan', desc: 'AI + You' },
  { icon: Play, label: 'Run', desc: 'Mocked deps' },
  { icon: Eye, label: 'Review', desc: 'Approve' },
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
              Backend QA that{' '}
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

          {/* Right — Boxy phase layout */}
          <motion.div
            className="relative mx-auto lg:mx-0 w-full max-w-md lg:max-w-none"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <div className="rounded-2xl border border-lavender-grey/30 bg-white overflow-hidden shadow-lg shadow-space-indigo/5">
              {/* Window bar */}
              <div className="px-4 py-3 border-b border-lavender-grey/20 bg-platinum flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-lavender-grey font-mono font-medium">GritQA</span>
              </div>

              {/* Phase grid */}
              <div className="p-6 md:p-8 grid grid-cols-2 gap-4">
                {phases.map((phase, i) => (
                  <motion.div
                    key={phase.label}
                    className="flex flex-col items-center gap-2 p-5 rounded-xl border border-lavender-grey/20 bg-platinum hover:border-punch-red/30 hover:bg-white transition-all cursor-default"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
                    whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(43,45,66,0.06)' }}
                  >
                    <phase.icon className="h-6 w-6 text-space-indigo" />
                    <span className="text-sm font-bold text-space-indigo">{phase.label}</span>
                    <span className="text-xs text-lavender-grey font-mono">{phase.desc}</span>
                  </motion.div>
                ))}
              </div>

              {/* Bottom bar */}
              <div className="px-6 py-3 border-t border-lavender-grey/20 flex items-center justify-between text-xs font-mono text-lavender-grey">
                <span className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  4 phases · 1 pipeline
                </span>
                <span>v0.1.0</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
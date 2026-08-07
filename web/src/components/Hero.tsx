'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function Hero() {
  return (
    <section className="bg-platinum pt-24 pb-20 md:pt-36 md:pb-32 overflow-hidden">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-lavender-grey/30 bg-white text-sm font-medium text-lavender-grey mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Sparkles className="h-4 w-4 text-punch-red" />
          <span>Open Source & Free</span>
          <ArrowRight className="h-4 w-4 text-punch-red" />
        </motion.div>

        <motion.h1
          className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] text-space-indigo"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <span className="text-punch-red">AI</span>-powered backend testing
          <br />
          that <span className="text-punch-red">reads your code</span>.
        </motion.h1>

        <motion.p
          className="mt-6 text-lg md:text-xl text-lavender-grey leading-relaxed max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          GritQA indexes your codebase, generates test plans from what actually
          changed, and runs them against real Docker databases — all on your machine.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <motion.button
            className="flex items-center gap-2 px-8 py-4 bg-punch-red text-platinum rounded-full text-sm font-semibold hover:bg-classic-crimson transition-colors shadow-sm shadow-punch-red/20"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Start Testing Free
            <ArrowRight className="h-4 w-4" />
          </motion.button>
          <motion.button
            className="flex items-center gap-2 px-8 py-4 border border-lavender-grey/30 text-space-indigo rounded-full text-sm font-semibold hover:bg-lavender-grey/10 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            View Docs
            <ArrowRight className="h-4 w-4" />
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
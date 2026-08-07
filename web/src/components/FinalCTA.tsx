'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { fadeInUp, staggerContainer, buttonHover, buttonTap } from '@/lib/animations';

export default function FinalCTA() {
  return (
    <section className="bg-ghost-white py-24 lg:py-32 px-6">
      <div className="mx-auto max-w-5xl">
        <motion.div
          className="relative rounded-3xl bg-onyx px-6 py-20 md:py-24 text-center overflow-hidden shadow-2xl shadow-onyx/10 border border-ash-grey/20"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
        >
          {/* Background decoration - solid color, no gradient */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-brick-ember/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-brick-ember/5 rounded-full blur-2xl" />

          <div className="relative z-10">
            <motion.div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ash-grey/20 bg-white/5 text-sm font-medium text-ash-grey mb-8"
              variants={fadeInUp}
            >
              <Sparkles className="h-4 w-4 text-brick-ember" />
              <span>Open Source & Free</span>
            </motion.div>

            <motion.h2
              className="text-3xl md:text-5xl font-bold tracking-tight text-ghost-white"
              variants={fadeInUp}
            >
              Ready to stop writing tests manually?
            </motion.h2>

            <motion.p
              className="mx-auto mt-6 max-w-xl text-lg text-ash-grey/80"
              variants={fadeInUp}
            >
              Join the waitlist. GritQA is open source and free.
            </motion.p>

            <motion.form
              className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-0"
              variants={fadeInUp}
            >
              <input
                type="email"
                placeholder="you@company.com"
                className="w-full sm:w-72 rounded-full sm:rounded-r-none sm:rounded-l-full border border-ash-grey/20 bg-white/5 px-6 py-4 text-sm text-ghost-white placeholder-ash-grey/50 focus:border-brick-ember focus:outline-none backdrop-blur-sm transition-colors hover:bg-white/10"
              />
              <motion.button
                type="submit"
                className="w-full sm:w-auto rounded-full sm:rounded-l-none sm:rounded-r-full bg-brick-ember px-8 py-4 text-sm font-semibold text-ghost-white hover:bg-brick-ember/90 shadow-lg transition-colors whitespace-nowrap"
                whileHover="hover"
                whileTap="tap"
                variants={{ hover: buttonHover, tap: buttonTap }}
              >
                Join Waitlist
                <ArrowRight className="inline-block ml-2 h-4 w-4" />
              </motion.button>
            </motion.form>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
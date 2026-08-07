'use client';

import { motion } from 'framer-motion';
import { Clock, Target, Shield, FileCheck } from 'lucide-react';
import { fadeInUp, staggerContainer } from '@/lib/animations';

const metrics = [
  { value: '< 5 min', label: 'Push to results', icon: Clock },
  { value: '> 80%', label: 'AI accuracy on first attempt', icon: Target },
  { value: '100%', label: 'Local execution', icon: Shield },
  { value: '0', label: 'Lines of test code you write', icon: FileCheck },
];

export default function TrustBlock() {
  return (
    <section className="bg-onyx py-20 relative overflow-hidden">
      {/* Subtle background color block - no gradient */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-brick-ember/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="mx-auto max-w-7xl px-6 relative z-10">
        <motion.div
          className="grid grid-cols-2 gap-10 md:gap-8 md:grid-cols-4"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
        >
          {metrics.map((m) => (
            <motion.div
              key={m.label}
              className="text-center group"
              variants={fadeInUp}
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brick-ember/10 mb-4 transition-transform group-hover:scale-110">
                <m.icon className="h-6 w-6 text-brick-ember" />
              </div>
              <p className="text-3xl font-bold text-ghost-white md:text-5xl tracking-tight">
                {m.value}
              </p>
              <p className="mt-3 text-sm font-medium tracking-wide text-ash-grey/70">
                {m.label}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
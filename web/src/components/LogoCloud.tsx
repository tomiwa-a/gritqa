'use client';

import { motion } from 'framer-motion';
import { fadeInUp, staggerContainer } from '@/lib/animations';

const logos = [
  { name: 'Stripe', initials: 'St' },
  { name: 'Vercel', initials: 'Ve' },
  { name: 'Linear', initials: 'Li' },
  { name: 'Notion', initials: 'No' },
  { name: 'Figma', initials: 'Fi' },
  { name: 'GitHub', initials: 'GH' },
  { name: 'Supabase', initials: 'Su' },
  { name: 'Railway', initials: 'Ra' },
];

export default function LogoCloud() {
  return (
    <section className="border-t border-ash-grey/20 bg-ghost-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          className="text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
        >
          <motion.p
            className="text-sm font-semibold text-dim-grey uppercase tracking-wider"
            variants={fadeInUp}
          >
            Trusted by backend teams at
          </motion.p>
        </motion.div>

        <motion.div
          className="flex flex-wrap justify-center items-center gap-x-12 gap-y-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
        >
          {logos.map((logo, i) => (
            <motion.div
              key={logo.name}
              className="flex items-center gap-2 text-dim-grey/50 hover:text-dim-grey transition-colors"
              variants={fadeInUp}
            >
              <div className="h-8 w-8 rounded-lg bg-ash-grey/30 flex items-center justify-center text-xs font-bold font-mono">
                {logo.initials}
              </div>
              <span className="text-lg font-semibold tracking-tight">{logo.name}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
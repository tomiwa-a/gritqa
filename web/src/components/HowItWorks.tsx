'use client';

import { motion } from 'framer-motion';
import { GitBranch, Sparkles, Container, CheckCircle } from 'lucide-react';
import { fadeInUp, staggerContainer } from '@/lib/animations';

const steps = [
  {
    number: '01',
    icon: GitBranch,
    name: 'Push your code',
    description: 'GritQA detects what changed via git diff and maps affected functions using Tree-sitter AST parsing.',
    code: `<span class="text-dim-grey">$</span> git push origin main
<span class="text-brick-ember">→</span> 3 files changed
<span class="text-brick-ember">→</span> order_controller.go (L84)
<span class="text-brick-ember">→</span> payment_service.go (L112)
<span class="text-brick-ember">→</span> models/order.go (L8)`,
    offset: false,
  },
  {
    number: '02',
    icon: Sparkles,
    name: 'AI generates tests',
    description: 'Readable test plans with HTTP requests, variable extraction, and assertions — generated from your actual source code.',
    code: `<span class="text-brick-ember">steps:</span>
  - <span class="text-dim-grey">name:</span> <span class="text-onyx">"Login"</span>
    POST /auth/login
    <span class="text-brick-ember">extract:</span> authToken
  - <span class="text-dim-grey">name:</span> <span class="text-onyx">"Create Order"</span>
    POST /orders
    <span class="text-brick-ember">assert:</span> status == 201`,
    offset: true,
  },
  {
    number: '03',
    icon: Container,
    name: 'Run tests locally',
    description: 'Tests execute inside ephemeral Docker containers with real PostgreSQL. Full isolation, instant teardown.',
    code: `<span class="text-green-600">✓</span> Container started (240ms)
<span class="text-green-600">✓</span> Migrations applied
<span class="text-green-600">✓</span> 4/4 tests passed
<span class="text-green-600">✓</span> Container destroyed
<span class="text-dim-grey mt-2 block">Total: 1.18s</span>`,
    offset: false,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-ghost-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <motion.div
          className="text-center max-w-2xl mx-auto mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
        >
          <motion.h2
            className="text-3xl md:text-5xl font-bold tracking-tight text-onyx"
            variants={fadeInUp}
          >
            Three steps from code change to{' '}
            <span className="text-brick-ember">confident deployments</span>
          </motion.h2>
          <motion.p
            className="text-dim-grey mt-4 text-lg"
            variants={fadeInUp}
          >
            Push, generate, run. That&apos;s it.
          </motion.p>
        </motion.div>

        <motion.div
          className="grid lg:grid-cols-3 gap-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
        >
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              className={`relative group rounded-3xl border border-ash-grey/30 bg-white p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden ${
                step.offset ? 'lg:mt-8' : ''
              }`}
              variants={fadeInUp}
            >
              {/* Hover glow effect */}
              <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-brick-ember/5 opacity-0 group-hover:opacity-100 transition-opacity blur-3xl" />

              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ghost-white font-mono text-lg font-bold text-brick-ember shadow-sm">
                    {step.number}
                  </span>
                  <h3 className="text-xl font-bold text-onyx">{step.name}</h3>
                </div>

                <p className="text-base text-dim-grey leading-relaxed">
                  {step.description}
                </p>

                <div className="mt-8 rounded-xl border border-ash-grey/20 bg-ghost-white/50 p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-inner overflow-x-auto">
                  <pre className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: step.code }} />
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
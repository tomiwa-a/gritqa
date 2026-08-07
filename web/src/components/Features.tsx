'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const features = [
  {
    id: 'index',
    num: '01',
    title: 'Codebase Indexing',
    tagline: 'GritQA knows what changed and what depends on it.',
    points: [
      'Tree-sitter AST parsing for 100+ languages',
      'Maps functions, classes, routes, and imports',
      'Dependency graph across your codebase',
      'Incremental re-indexing — only changed files',
    ],
    terminal: [
      { text: '$ gritqa index', color: 'text-lavender-grey' },
      { text: '✓  Scanning codebase...', color: 'text-green-400' },
      { text: '✓  Indexed 1,247 files in 2.1s', color: 'text-green-400' },
      { text: '✓  Built dependency graph', color: 'text-green-400' },
      { text: '', color: '' },
      { text: '  CreateOrder()      → order_controller.go:45', color: 'text-white' },
      { text: '  ProcessPayment()  → payment_service.go:12', color: 'text-white' },
      { text: '  Order struct      → models/order.go:8', color: 'text-white' },
      { text: '', color: '' },
      { text: '  Dependencies:  3 affected endpoints', color: 'text-lavender-grey' },
    ],
  },
  {
    id: 'plan',
    num: '02',
    title: 'Test Plan Generation',
    tagline: 'Structured test plans from your actual code.',
    points: [
      'Multi-step flows with variable chaining',
      'Extract tokens, IDs, and responses',
      'Assert status codes, body fields, headers',
      'Review every step before it runs',
    ],
    terminal: [
      { text: '$ gritqa plan', color: 'text-lavender-grey' },
      { text: '✓  Generating test plan...', color: 'text-green-400' },
      { text: '✓  4 steps created', color: 'text-green-400' },
      { text: '', color: '' },
      { text: '  name: "E2E Order Flow"', color: 'text-white' },
      { text: '  steps:', color: 'text-white' },
      { text: '    - POST /auth/login   → extract token', color: 'text-punch-red' },
      { text: '    - POST /orders       → assert 201', color: 'text-punch-red' },
      { text: '    - GET  /orders/:id   → assert body.status', color: 'text-punch-red' },
      { text: '    - DELETE /orders/:id → assert 204', color: 'text-punch-red' },
    ],
  },
  {
    id: 'run',
    num: '03',
    title: 'Isolated Test Runs',
    tagline: 'Real databases, real constraints, instant teardown.',
    points: [
      'Ephemeral containers per test plan',
      'tmpfs RAM storage — no disk I/O',
      'Real PostgreSQL with real constraints',
      'Destroyed instantly after execution',
    ],
    terminal: [
      { text: '$ gritqa run', color: 'text-lavender-grey' },
      { text: '✓  Starting container (postgres:16-alpine)', color: 'text-green-400' },
      { text: '✓  Container ready (210ms)', color: 'text-green-400' },
      { text: '✓  Running E2E Order Flow...', color: 'text-green-400' },
      { text: '', color: '' },
      { text: '    Step 1: Login           ✓ PASS  245ms', color: 'text-white' },
      { text: '    Step 2: Create Order    ✓ PASS  512ms', color: 'text-white' },
      { text: '    Step 3: Verify          ✓ PASS  189ms', color: 'text-white' },
      { text: '    Step 4: Cleanup         ✓ PASS   67ms', color: 'text-white' },
      { text: '', color: '' },
      { text: '  4/4 passed  ·  1.2s  ·  0 failed', color: 'text-green-400' },
      { text: '✓  Container destroyed', color: 'text-green-400' },
    ],
  },
  {
    id: 'review',
    num: '04',
    title: 'Human Review',
    tagline: 'You approve every step before anything runs.',
    points: [
      'Edit, reject, or approve each step',
      'Tweak payloads, assertions, headers',
      'Full control over test plan execution',
      'GritQA does the heavy lifting — you call the shots',
    ],
    terminal: [
      { text: '$ gritqa review', color: 'text-lavender-grey' },
      { text: '  Status:  DRAFT → REVIEW → APPROVED', color: 'text-white' },
      { text: '', color: '' },
      { text: '    Step 1: Login            [✓ approved]', color: 'text-green-400' },
      { text: '    Step 2: Create Order     [✓ approved]', color: 'text-green-400' },
      { text: '    Step 3: Verify           [✎ edited]', color: 'text-punch-red' },
      { text: '    Step 4: Cleanup          [✓ approved]', color: 'text-green-400' },
      { text: '', color: '' },
      { text: '  ✓  Plan approved — ready to run', color: 'text-green-400' },
    ],
  },
];

export default function Features() {
  const [activeTab, setActiveTab] = useState('index');
  const active = features.find((f) => f.id === activeTab) || features[0];

  return (
    <section id="features" className="bg-white py-24 lg:py-32 border-t border-lavender-grey/10">
      <div className="mx-auto max-w-7xl px-6">
        <motion.div
          className="text-center max-w-xl mx-auto mb-14"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-space-indigo">
            What GritQA does for your team
          </h2>
        </motion.div>

        {/* Tabs */}
        <div className="flex justify-center gap-3 mb-12 flex-wrap">
          {features.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveTab(f.id)}
              className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                activeTab === f.id
                  ? 'bg-space-indigo text-white shadow-md'
                  : 'bg-platinum text-lavender-grey hover:bg-lavender-grey/20 hover:text-space-indigo'
              }`}
            >
              {f.num} {f.title}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
            className="grid lg:grid-cols-2 gap-10 items-start"
          >
            {/* Left — text */}
            <div className="pt-4">
              <span className="inline-block text-5xl font-bold font-mono text-space-indigo/10 mb-2">
                {active.num}
              </span>
              <h3 className="text-2xl md:text-3xl font-bold text-space-indigo mb-3">
                {active.title}
              </h3>
              <p className="text-lavender-grey text-lg leading-relaxed mb-8">
                {active.tagline}
              </p>
              <ul className="space-y-3">
                {active.points.map((pt, i) => (
                  <motion.li
                    key={pt}
                    className="flex items-start gap-3 text-space-indigo"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-punch-red flex-shrink-0" />
                    {pt}
                  </motion.li>
                ))}
              </ul>
            </div>

            {/* Right — terminal */}
            <div className="rounded-2xl border border-lavender-grey/20 bg-space-indigo overflow-hidden shadow-xl shadow-space-indigo/10">
              {/* Window bar */}
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-lavender-grey font-mono">gritqa</span>
              </div>

              {/* Terminal body */}
              <div className="p-6 font-mono text-sm leading-loose">
                {active.terminal.map((line, i) => (
                  <motion.div
                    key={`${active.id}-${i}`}
                    className={line.color || 'text-white'}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05 }}
                  >
                    {line.text || '\u00A0'}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
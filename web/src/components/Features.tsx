'use client';

import { motion } from 'framer-motion';

const features = [
  {
    num: '01',
    title: 'Codebase Indexing',
    desc: 'Tree-sitter AST parsing maps your entire codebase — functions, classes, routes, and dependency chains. GritQA knows what changed and what depends on it.',
    snippet: `CreateOrder()      → order_controller.go:45
ProcessPayment()  → payment_service.go:12
Order struct      → models/order.go:8

Dependencies:  3 affected endpoints`,
    accent: 'space-indigo',
    accentText: 'text-space-indigo',
    headerBg: 'bg-space-indigo',
    snippetBg: 'bg-space-indigo',
    snippetText: 'text-lavender-grey/70',
    snippetAccent: 'text-punch-red',
    border: 'border-space-indigo/20',
  },
  {
    num: '02',
    title: 'Test Plan Generation',
    desc: 'Structured test plans built from your actual code. Multi-step flows with variable extraction and assertions. Review every step before it runs.',
    snippet: `name: "E2E Order Flow"
steps:
  - POST /auth/login   → extract token
  - POST /orders       → assert 201
  - GET  /orders/:id   → assert body.status
  - DELETE /orders/:id → assert 204`,
    accent: 'punch-red',
    accentText: 'text-punch-red',
    headerBg: 'bg-punch-red',
    snippetBg: 'bg-punch-red',
    snippetText: 'text-platinum/80',
    snippetAccent: 'text-platinum',
    border: 'border-punch-red/20',
  },
  {
    num: '03',
    title: 'Isolated Test Runs',
    desc: 'Every test plan runs in its own ephemeral container. Real databases with real constraints — then torn down instantly. No state leaks, no cleanup scripts.',
    snippet: `Container:  postgres:16-alpine
Storage:    tmpfs (RAM)
Boot:       210ms
Teardown:   instant
Isolation:  per-test-plan`,
    accent: 'classic-crimson',
    accentText: 'text-classic-crimson',
    headerBg: 'bg-classic-crimson',
    snippetBg: 'bg-classic-crimson',
    snippetText: 'text-platinum/80',
    snippetAccent: 'text-platinum',
    border: 'border-classic-crimson/20',
  },
  {
    num: '04',
    title: 'Human Review',
    desc: 'You stay in control. Review, edit, or reject every test plan step before execution. GritQA does the heavy lifting — you make the call.',
    snippet: `Status:  DRAFT → REVIEW → APPROVED

Step 1: Login        [✓ approved]
Step 2: Create Order [✓ approved]
Step 3: Verify       [✎ edited]
Step 4: Cleanup      [✓ approved]`,
    accent: 'lavender-grey',
    accentText: 'text-lavender-grey',
    headerBg: 'bg-lavender-grey',
    snippetBg: 'bg-lavender-grey',
    snippetText: 'text-platinum/80',
    snippetAccent: 'text-white',
    border: 'border-lavender-grey/20',
  },
];

function CurlyRight() {
  return (
    <svg width="80" height="44" viewBox="0 0 80 44" fill="none" className="text-punch-red/50">
      <path
        d="M 0,22 C 28,22 34,-8 52,12 C 60,20 64,24 74,22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M 66,18 L 76,22 L 66,26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CurlyDownLeft() {
  return (
    <svg width="60" height="76" viewBox="0 0 60 76" fill="none" className="text-punch-red/50">
      <path
        d="M 56,4 C 56,28 34,32 20,50 C 12,60 8,66 8,72"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M 4,64 L 8,74 L 12,64" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CurlyRightBottom() {
  return (
    <svg width="60" height="44" viewBox="0 0 60 44" fill="none" className="text-punch-red/50">
      <path
        d="M 0,22 C 20,22 24,42 40,26 C 46,20 50,22 54,22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 3"
      />
      <path d="M 50,18 L 56,22 L 50,26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Features() {
  return (
    <section
      id="features"
      className="relative bg-space-indigo/[0.02] py-24 lg:py-32 border-t border-lavender-grey/10 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl px-6">
        <motion.div
          className="text-center max-w-xl mx-auto mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-space-indigo">
            Four things GritQA does for your team
          </h2>
          <p className="text-lavender-grey mt-4 text-lg">
            No more guessing what broke. No more manual test scripts.
          </p>
        </motion.div>

        <div className="relative grid md:grid-cols-2 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="group relative flex flex-col rounded-2xl border border-lavender-grey/15 bg-white overflow-hidden hover:shadow-lg transition-all"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              {/* Colored header strip */}
              <div className={`${f.headerBg} px-6 py-5 flex items-center gap-4`}>
                <span className="text-3xl font-bold text-white font-mono tracking-tight">{f.num}</span>
                <h3 className="text-lg font-bold text-white">{f.title}</h3>
              </div>

              {/* Body */}
              <div className="flex flex-col flex-1 p-6">
                <p className="text-lavender-grey leading-relaxed">
                  {f.desc}
                </p>

                {/* Dark terminal code box */}
                <div className={`mt-6 rounded-xl ${f.snippetBg} p-5 font-mono text-sm leading-relaxed overflow-x-auto`}>
                  <pre className={`whitespace-pre-wrap ${f.snippetText}`}>{f.snippet}</pre>
                </div>
              </div>

              {/* Curly arrow connector */}
              {i === 0 && (
                <div className="absolute -right-6 top-1/2 -translate-y-1/2 z-10 hidden md:block">
                  <CurlyRight />
                </div>
              )}
              {i === 1 && (
                <div className="absolute -right-4 -bottom-3 z-10 hidden md:block">
                  <CurlyDownLeft />
                </div>
              )}
              {i === 2 && (
                <div className="absolute -right-6 top-1/3 -translate-y-1/2 z-10 hidden md:block">
                  <CurlyRightBottom />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
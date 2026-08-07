'use client';

import { motion } from 'framer-motion';
import { Search, FileText, Container, Eye } from 'lucide-react';

const features = [
  {
    icon: Search,
    title: 'Codebase Indexing',
    desc: 'Tree-sitter AST parsing maps your entire codebase — functions, classes, routes, and dependency chains. GritQA knows what changed and what depends on it.',
    snippet: `CreateOrder()      → order_controller.go:45
ProcessPayment()  → payment_service.go:12
Order struct      → models/order.go:8

Dependencies:  3 affected endpoints`,
    accent: 'space-indigo',
    bg: 'bg-space-indigo/5',
    border: 'border-space-indigo/20',
    iconBg: 'bg-space-indigo/10',
    iconColor: 'text-space-indigo',
  },
  {
    icon: FileText,
    title: 'Test Plan Generation',
    desc: 'Structured test plans built from your actual code. Multi-step flows with variable extraction and assertions. Review every step before it runs.',
    snippet: `name: "E2E Order Flow"
steps:
  - POST /auth/login   → extract token
  - POST /orders       → assert 201
  - GET  /orders/:id   → assert body.status
  - DELETE /orders/:id → assert 204`,
    accent: 'punch-red',
    bg: 'bg-punch-red/5',
    border: 'border-punch-red/20',
    iconBg: 'bg-punch-red/10',
    iconColor: 'text-punch-red',
  },
  {
    icon: Container,
    title: 'Isolated Test Runs',
    desc: 'Every test plan runs in its own ephemeral container. Real databases with real constraints — then torn down instantly. No state leaks, no cleanup scripts.',
    snippet: `Container:  postgres:16-alpine
Storage:    tmpfs (RAM)
Boot:       210ms
Teardown:   instant
Isolation:  per-test-plan`,
    accent: 'classic-crimson',
    bg: 'bg-classic-crimson/5',
    border: 'border-classic-crimson/20',
    iconBg: 'bg-classic-crimson/10',
    iconColor: 'text-classic-crimson',
  },
  {
    icon: Eye,
    title: 'Human Review',
    desc: 'You stay in control. Review, edit, or reject every test plan step before execution. GritQA does the heavy lifting — you make the call.',
    snippet: `Status:  DRAFT → REVIEW → APPROVED

Step 1: Login        [✓ approved]
Step 2: Create Order [✓ approved]
Step 3: Verify       [✎ edited]
Step 4: Cleanup      [✓ approved]`,
    accent: 'lavender-grey',
    bg: 'bg-lavender-grey/5',
    border: 'border-lavender-grey/20',
    iconBg: 'bg-lavender-grey/10',
    iconColor: 'text-lavender-grey',
  },
];

function CurlyRight() {
  return (
    <svg width="72" height="40" viewBox="0 0 72 40" fill="none" className="text-lavender-grey/40">
      <path
        d="M 0,20 C 24,20 30,-6 48,10 C 56,18 60,22 66,20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M 58,16 L 68,20 L 58,24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CurlyDownLeft() {
  return (
    <svg width="56" height="72" viewBox="0 0 56 72" fill="none" className="text-lavender-grey/40">
      <path
        d="M 52,0 C 52,24 30,28 16,46 C 8,56 4,62 4,68"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M 0,60 L 4,70 L 8,60" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CurlyRightBottom() {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" fill="none" className="text-lavender-grey/40">
      <path
        d="M 0,20 C 18,20 22,38 36,22 C 42,16 46,18 50,20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M 46,16 L 52,20 L 46,24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Features() {
  return (
    <section
      id="features"
      className="relative bg-white py-24 lg:py-32 border-t border-lavender-grey/10 overflow-hidden"
    >
      {/* Background accent blobs — indigo/blue tones */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-space-indigo/[0.02] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-lavender-grey/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-6">
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
              className={`group relative flex flex-col rounded-2xl border ${f.border} ${f.bg} p-6 md:p-8 hover:bg-white hover:shadow-md transition-all`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              {/* Accent dot */}
              <div className={`absolute top-5 right-5 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-space-indigo/30' : i === 1 ? 'bg-punch-red/30' : i === 2 ? 'bg-classic-crimson/30' : 'bg-lavender-grey/30'}`} />

              <div className="flex items-center gap-3 mb-4">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.iconBg} border ${f.border}`}>
                  <f.icon className={`h-5 w-5 ${f.iconColor}`} />
                </div>
                <h3 className="text-lg font-bold text-space-indigo">{f.title}</h3>
              </div>

              <p className="text-lavender-grey leading-relaxed flex-1">
                {f.desc}
              </p>

              <div className={`mt-6 rounded-xl border ${f.border} bg-white p-4 font-mono text-sm leading-relaxed text-space-indigo overflow-x-auto`}>
                <pre className="whitespace-pre-wrap">{f.snippet}</pre>
              </div>

              {/* Curly arrow connector */}
              {i === 0 && (
                <div className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 hidden md:block">
                  <CurlyRight />
                </div>
              )}
              {i === 1 && (
                <div className="absolute -right-4 -bottom-2 z-10 hidden md:block">
                  <CurlyDownLeft />
                </div>
              )}
              {i === 2 && (
                <div className="absolute -right-4 top-1/3 -translate-y-1/2 z-10 hidden md:block">
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
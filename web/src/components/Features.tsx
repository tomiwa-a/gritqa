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
  },
];

export default function Features() {
  return (
    <section id="features" className="bg-white py-24 lg:py-32 border-t border-lavender-grey/10">
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

        <div className="grid md:grid-cols-2 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="group flex flex-col rounded-2xl border border-lavender-grey/15 bg-platinum p-6 md:p-8 hover:border-lavender-grey/30 hover:bg-white transition-all"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-lavender-grey/20">
                  <f.icon className="h-5 w-5 text-space-indigo" />
                </div>
                <h3 className="text-lg font-bold text-space-indigo">{f.title}</h3>
              </div>

              <p className="text-lavender-grey leading-relaxed flex-1">
                {f.desc}
              </p>

              <div className="mt-6 rounded-xl bg-white border border-lavender-grey/15 p-4 font-mono text-sm leading-relaxed text-space-indigo overflow-x-auto">
                <pre className="whitespace-pre-wrap">{f.snippet}</pre>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
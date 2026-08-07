'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { fadeInUp, staggerContainer } from '@/lib/animations';

const yamlLines = [
  { key: 'name', value: '"E2E Order Flow"', type: 'key-value' },
  { key: 'steps', value: '', type: 'key-only' },
  { key: 'id', value: 'login', type: 'list-item' },
  { key: 'name', value: '"User Login"', type: 'list-item' },
  { key: 'request', value: '', type: 'list-item' },
  { key: 'method', value: 'POST', type: 'nested' },
  { key: 'url', value: '/auth/login', type: 'nested' },
  { key: 'body', value: '', type: 'nested' },
  { key: 'email', value: '"test@example.com"', type: 'deeper-nested' },
  { key: 'password', value: '"s3cret!"', type: 'deeper-nested' },
];

const renderedSteps = [
  {
    number: 1,
    name: 'User Login',
    method: 'POST',
    path: '/auth/login',
    body: '{ "email": "test@example.com" }',
    response: '200 OK',
    badge: 'Token extracted',
    badgeColor: 'green' as const,
  },
  {
    number: 2,
    name: 'Create Order',
    method: 'POST',
    path: '/orders',
    body: 'Uses authToken',
    response: '201 Created',
    badge: 'Order ID extracted',
    badgeColor: 'green' as const,
  },
];

export default function CodePreview() {
  return (
    <section className="border-t border-ash-grey/30 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6">
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
            Readable tests you actually{' '}
            <span className="text-brick-ember">understand</span>
          </motion.h2>
          <motion.p
            className="text-dim-grey mt-4 text-lg"
            variants={fadeInUp}
          >
            AI generates structured plans. The dashboard renders them into human-readable steps.
          </motion.p>
        </motion.div>

        <motion.div
          className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2 items-start"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
        >
          {/* Left panel — YAML */}
          <motion.div
            className="overflow-hidden rounded-2xl border border-ash-grey/30 bg-white shadow-lg shadow-onyx/5"
            variants={fadeInUp}
          >
            <div className="border-b border-ash-grey/30 bg-ghost-white/80 px-4 py-3 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-2 font-mono text-xs text-dim-grey">
                .gritqa/test-plan.yaml
              </span>
            </div>
            <pre className="p-6 font-mono text-xs leading-relaxed text-onyx overflow-x-auto">
              <span className="text-brick-ember">name</span>
              {`: `}
              <span className="text-dim-grey">&quot;E2E Order Flow&quot;</span>
              {`\n`}
              <span className="text-brick-ember">steps</span>
              {`:\n`}
              {`  - `}
              <span className="text-brick-ember">id</span>
              {`: login\n`}
              {`    `}
              <span className="text-brick-ember">name</span>
              {`: `}
              <span className="text-dim-grey">&quot;User Login&quot;</span>
              {`\n`}
              {`    `}
              <span className="text-brick-ember">request</span>
              {`:\n`}
              {`      `}
              <span className="text-brick-ember">method</span>
              {`: POST\n`}
              {`      `}
              <span className="text-brick-ember">url</span>
              {`: /auth/login\n`}
              {`      `}
              <span className="text-brick-ember">body</span>
              {`:\n`}
              {`        `}
              <span className="text-brick-ember">email</span>
              {`: `}
              <span className="text-dim-grey">&quot;test@example.com&quot;</span>
              {`\n`}
              {`        `}
              <span className="text-brick-ember">password</span>
              {`: `}
              <span className="text-dim-grey">&quot;s3cret!&quot;</span>
              {`\n`}
              {`    `}
              <span className="text-brick-ember">extract</span>
              {`:\n`}
              {`      `}
              <span className="text-brick-ember">authToken</span>
              {`: `}
              <span className="text-dim-grey">&quot;$.token&quot;</span>
              {`\n\n`}
              {`  - `}
              <span className="text-brick-ember">id</span>
              {`: create_order\n`}
              {`    `}
              <span className="text-brick-ember">name</span>
              {`: `}
              <span className="text-dim-grey">&quot;Create Order&quot;</span>
              {`\n`}
              {`    `}
              <span className="text-brick-ember">dependsOn</span>
              {`: [login]\n`}
              {`    `}
              <span className="text-brick-ember">request</span>
              {`:\n`}
              {`      `}
              <span className="text-brick-ember">method</span>
              {`: POST\n`}
              {`      `}
              <span className="text-brick-ember">url</span>
              {`: /orders\n`}
              {`      `}
              <span className="text-brick-ember">headers</span>
              {`:\n`}
              {`        `}
              <span className="text-brick-ember">Authorization</span>
              {`: `}
              <span className="text-dim-grey">&quot;Bearer {`{{authToken}}`}&quot;</span>
              {`\n`}
              {`    `}
              <span className="text-brick-ember">assert</span>
              {`:\n`}
              {`      `}
              <span className="text-brick-ember">status</span>
              {`: 201`}
            </pre>
          </motion.div>

          {/* Right panel — rendered steps */}
          <motion.div
            className="space-y-4"
            variants={fadeInUp}
          >
            {renderedSteps.map((step) => (
              <motion.div
                key={step.number}
                className="rounded-2xl border border-ash-grey/30 bg-white p-5 hover:border-ash-grey/50 hover:shadow-md transition-all"
                variants={fadeInUp}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-onyx text-xs font-bold text-ghost-white">
                      {step.number}
                    </span>
                    <span className="ml-3 font-semibold text-onyx">
                      {step.name}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-brick-ember/10 text-brick-ember">
                    {step.method}
                  </span>
                </div>
                <p className="text-xs text-dim-grey font-mono">{step.path}</p>
                <div className="mt-3 rounded-lg bg-ghost-white p-3 font-mono text-xs text-dim-grey">
                  {step.body}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">
                    {step.response}
                  </span>
                  <span className="text-xs text-dim-grey">
                    {step.badge}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
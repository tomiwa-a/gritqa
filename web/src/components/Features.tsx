'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileCode,
  Zap,
  Database,
  Eye,
  CheckCircle,
  ArrowRight,
  Sparkles,
  Clock,
  Shield,
  RefreshCw,
} from 'lucide-react';
import { fadeInUp, staggerContainer, fadeIn } from '@/lib/animations';

const features = [
  {
    id: 'indexing',
    icon: FileCode,
    name: 'Codebase Indexing',
    tagline: 'Maps your entire codebase in minutes',
    description: 'Tree-sitter AST parsing builds a complete index of your functions, classes, routes, and dependency chains. Understands what changed and what tests need to run.',
    code: `<span class="text-dim-grey">Indexed symbols:</span>
CreateOrder()  <span class="text-brick-ember">→</span> order_controller.go:45
ProcessPayment() <span class="text-brick-ember">→</span> payment_service.go:12
Order struct   <span class="text-brick-ember">→</span> models/order.go:8
<span class="text-dim-grey mt-2 block">Dependencies:  3 affected endpoints</span>`,
    highlights: ['Tree-sitter AST parsing', 'Function & route mapping', 'Dependency chain analysis', 'Incremental re-indexing'],
  },
  {
    id: 'ai-generation',
    icon: Sparkles,
    name: 'AI Test Generation',
    tagline: 'Tests from what actually changed',
    description: 'AI reads your source code and drafts structured test plans tailored to your changes — not blind boilerplate. Every test is meaningful.',
    code: `<span class="text-brick-ember">{"{"}</span>
  <span class="text-onyx">"name"</span>: <span class="text-dim-grey">"Order Flow"</span>,
  <span class="text-onyx">"steps"</span>: [
    <span class="text-brick-ember">{"{"}</span> <span class="text-onyx">"POST /auth/login"</span>, extract: <span class="text-dim-grey">"token"</span> <span class="text-brick-ember">{"}"}</span>,
    <span class="text-brick-ember">{"{"}</span> <span class="text-onyx">"POST /orders"</span>, assert: <span class="text-dim-grey">"status == 201"</span> <span class="text-brick-ember">{"}"}</span>,
    <span class="text-brick-ember">{"{"}</span> <span class="text-onyx">"GET /orders/:id"</span>, assert: <span class="text-dim-grey">"body.status"</span> <span class="text-brick-ember">{"}"}</span>
  ]
<span class="text-brick-ember">{"}"}</span>`,
    highlights: ['Change-aware generation', 'Structured test plans', 'Variable extraction', 'Assertion inference'],
  },
  {
    id: 'real-db',
    icon: Database,
    name: 'Real Database Testing',
    tagline: 'Real PostgreSQL, zero contamination',
    description: 'Docker containers with tmpfs RAM storage. Real PostgreSQL with real constraints, indexes, and foreign keys. Zero data contamination between runs.',
    code: `<span class="text-dim-grey">Container:</span> postgres:16-alpine
<span class="text-dim-grey">Storage:</span>   tmpfs (RAM)
<span class="text-dim-grey">Boot:</span>      <span class="text-green-600">210ms</span>
<span class="text-dim-grey">Teardown:</span>  <span class="text-green-600">instant</span>
<span class="text-dim-grey">Isolation:</span> complete`,
    highlights: ['Docker containers', 'tmpfs RAM storage', 'Real constraints & FKs', 'Instant teardown'],
  },
  {
    id: 'review',
    icon: Eye,
    name: 'Human Review',
    tagline: 'AI generates, you approve',
    description: 'Review every test plan step before execution. Edit assertions, tweak payloads, or reject entirely. You stay in control.',
    code: `<span class="text-dim-grey">Status:</span> DRAFT → REVIEW → <span class="text-green-600">APPROVED</span>

Step 1: Login       <span class="text-green-600">[✓ approved]</span>
Step 2: Create Order <span class="text-green-600">[✓ approved]</span>
Step 3: Verify DB    <span class="text-brick-ember">[✎ edited]</span>
Step 4: Cleanup      <span class="text-green-600">[✓ approved]</span>`,
    highlights: ['Step-by-step review', 'Inline editing', 'Reject & regenerate', 'Approval workflow'],
  },
];

export default function Features() {
  const [activeTab, setActiveTab] = useState('indexing');
  const activeFeature = features.find((f) => f.id === activeTab) || features[0];

  return (
    <section id="features" className="border-t border-ash-grey/20 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section Header */}
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
            Built for real-world{' '}
            <span className="text-brick-ember">backend testing</span>
          </motion.h2>
          <motion.p
            className="text-dim-grey mt-4 text-lg"
            variants={fadeInUp}
          >
            Every feature designed to replace hours of manual test writing.
          </motion.p>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          className="flex flex-wrap justify-center gap-2 mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
        >
          {features.map((feature, i) => (
              <motion.button
                key={feature.id}
                onClick={() => setActiveTab(feature.id)}
                className={`flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition-all ${
                  activeTab === feature.id
                    ? 'bg-brick-ember text-ghost-white shadow-md shadow-brick-ember/20'
                    : 'bg-ghost-white/50 text-dim-grey hover:bg-ash-grey/50 hover:text-onyx border border-ash-grey/30'
                }`}
                variants={fadeInUp}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
              <feature.icon className="h-4 w-4" />
              {feature.name}
            </motion.button>
          ))}
        </motion.div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeFeature.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="grid lg:grid-cols-2 gap-12 items-center"
          >
            {/* Left — Description & Highlights */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-xl bg-brick-ember/10 flex items-center justify-center">
                  <activeFeature.icon className="h-6 w-6 text-brick-ember" />
                </div>
                <div>
                  <p className="text-sm text-brick-ember font-semibold">{activeFeature.tagline}</p>
                  <h3 className="text-2xl font-bold text-onyx">{activeFeature.name}</h3>
                </div>
              </div>

              <p className="text-lg text-dim-grey leading-relaxed mb-8">
                {activeFeature.description}
              </p>

              <div className="grid grid-cols-2 gap-3">
                {activeFeature.highlights.map((highlight, i) => (
                  <motion.div
                    key={highlight}
                    className="flex items-center gap-2 text-sm text-dim-grey"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                    {highlight}
                  </motion.div>
                ))}
              </div>

              <motion.button
                className="mt-8 flex items-center gap-2 px-6 py-3 bg-onyx text-ghost-white rounded-full text-sm font-semibold hover:bg-onyx/90 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Learn More
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </div>

            {/* Right — Code Preview */}
            <motion.div
              className="rounded-2xl border border-ash-grey/30 bg-white overflow-hidden shadow-lg shadow-onyx/5"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
            >
              {/* Title bar */}
              <div className="px-4 py-3 border-b border-ash-grey/30 flex items-center gap-2 bg-ghost-white/80">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-2 text-xs text-dim-grey font-mono">{activeFeature.id}.yml</span>
              </div>
              {/* Body */}
              <div className="p-6 font-mono text-sm leading-relaxed text-onyx bg-ghost-white/30 overflow-x-auto">
                <pre className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: activeFeature.code }} />
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
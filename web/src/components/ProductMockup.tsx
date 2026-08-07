'use client';

import { motion } from 'framer-motion';
import {
  ChevronRight,
  Database,
  FileCode,
  GitBranch,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  Search,
  Zap,
  Layers,
  FileText,
} from 'lucide-react';
import { fadeInUp, fadeIn, staggerContainer, scaleIn } from '@/lib/animations';

const sidebarItems = [
  { icon: Search, label: 'Index', active: true },
  { icon: FileText, label: 'Test Plans' },
  { icon: Zap, label: 'Rules' },
  { icon: Layers, label: 'Mocks' },
  { icon: Settings, label: 'Settings' },
];

const projects = [
  { name: 'api', icon: Database, branch: 'main', files: 1247 },
  { name: 'web', icon: FileCode, branch: 'feat/checkout', files: 892 },
  { name: 'cli', icon: GitBranch, branch: 'main', files: 456 },
];

const testSteps = [
  { number: 1, name: 'Login', method: 'POST', path: '/auth/login', status: 'pass', duration: '245ms' },
  { number: 2, name: 'Create Order', method: 'POST', path: '/orders', status: 'pass', duration: '512ms' },
  { number: 3, name: 'Verify Order', method: 'GET', path: '/orders/:id', status: 'pass', duration: '189ms' },
  { number: 4, name: 'Cleanup', method: 'DELETE', path: '/orders/:id', status: 'pass', duration: '67ms' },
];

const variables = [
  { key: 'auth_token', value: 'eyJhbGciOiJIUzI1NiIs...', type: 'extracted' },
  { key: 'order_id', value: 'ord_7x9k2m', type: 'extracted' },
  { key: 'user_id', value: 'usr_3n4p8q', type: 'extracted' },
  { key: 'base_url', value: 'http://localhost:8080', type: 'config' },
];

export default function ProductMockup() {
  return (
    <motion.div
      className="relative rounded-2xl border border-ash-grey/30 bg-white overflow-hidden shadow-xl shadow-onyx/5"
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
      style={{ minHeight: 480, maxHeight: 600 }}
    >
      <div className="flex h-full overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 border-r border-ash-grey/30 bg-ghost-white/50 flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-ash-grey/30 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <div className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="ml-1 text-xs font-medium text-onyx font-mono">GritQA</span>
          </div>

          {/* Projects */}
          <div className="px-3 py-3 border-b border-ash-grey/30">
            <p className="text-xs font-semibold text-dim-grey uppercase tracking-wider mb-2">Projects</p>
            <div className="space-y-1">
              {projects.map((project) => (
                <motion.div
                  key={project.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/50 transition-colors cursor-pointer"
                  initial="hidden"
                  animate="visible"
                  variants={fadeInUp}
                >
                  <project.icon className="h-4 w-4 text-brick-ember" />
                  <span className="text-sm font-medium text-onyx flex-1 truncate">{project.name}</span>
                  <span className="text-xs text-dim-grey font-mono">{project.branch}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
            {sidebarItems.map((item) => (
              <motion.button
                key={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  item.active
                    ? 'bg-brick-ember/10 text-brick-ember'
                    : 'text-dim-grey hover:bg-ash-grey/50 hover:text-onyx'
                }`}
                initial="hidden"
                animate="visible"
                variants={fadeInUp}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </motion.button>
            ))}
          </nav>

          {/* Run button */}
          <div className="p-3 border-t border-ash-grey/30">
            <motion.button
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brick-ember text-ghost-white rounded-lg font-semibold text-sm hover:bg-brick-ember/90 transition-colors"
              whileHover="hover"
              whileTap="tap"
              variants={{ hover: { scale: 1.02 }, tap: { scale: 0.98 } }}
            >
              <Play className="h-4 w-4" />
              Run Tests
            </motion.button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 p-6 overflow-y-auto">
          {/* Test Plan Header */}
          <motion.div className="mb-6" initial="hidden" animate="visible" variants={fadeInUp}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-dim-grey uppercase tracking-wider">Test Plan</p>
                <h2 className="text-xl font-bold text-onyx">E2E Order Flow</h2>
              </div>
              <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded-full">READY</span>
            </div>
            <p className="text-sm text-dim-grey">Generated from 3 changed files · 4 steps · Est. 1.2s</p>
          </motion.div>


          {/* Test Steps */}
          <motion.div className="space-y-2" initial="hidden" animate="visible" variants={staggerContainer}>
            {testSteps.map((step) => (
              <motion.div
                key={step.number}
                className="flex items-center gap-4 p-4 rounded-xl border border-ash-grey/30 bg-ghost-white/50 hover:border-ash-grey/50 transition-colors"
                variants={fadeInUp}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brick-ember/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-brick-ember">{step.number}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-brick-ember/10 text-brick-ember">{step.method}</span>
                    <span className="text-sm font-mono text-onyx truncate">{step.path}</span>
                  </div>
                  <p className="text-sm text-dim-grey">{step.name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`flex items-center gap-1 text-sm font-medium ${
                    step.status === 'pass' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {step.status === 'pass' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {step.status === 'pass' ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="text-xs text-dim-grey font-mono">{step.duration}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Summary */}
          <motion.div className="mt-6 pt-4 border-t border-ash-grey/30 flex items-center justify-between" initial="hidden" animate="visible" variants={fadeInUp}>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-onyx">4/4 passed</span>
              <span className="text-xs text-dim-grey">·</span>
              <span className="text-sm font-mono text-dim-grey">1.2s duration</span>
              <span className="text-xs text-dim-grey">·</span>
              <span className="text-sm font-medium text-green-600">0 failed</span>
            </div>
            <motion.button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-dim-grey hover:text-onyx hover:bg-ash-grey/50 rounded-lg transition-colors"
              whileHover="hover"
              whileTap="tap"
              variants={{ hover: { scale: 1.02 }, tap: { scale: 0.98 } }}
            >
              <Clock className="h-3.5 w-3.5" />
              View Timeline
            </motion.button>
          </motion.div>
        </main>

        {/* Right Panel - Variables */}
        <aside className="w-72 flex-shrink-0 border-l border-ash-grey/30 bg-ghost-white/50 flex flex-col hidden lg:block">
          <div className="px-4 py-3 border-b border-ash-grey/30">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-dim-grey uppercase tracking-wider">Variables</p>
              <span className="text-xs text-dim-grey font-mono">4 total</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {variables.map((v) => (
              <motion.div
                key={v.key}
                className="p-3 rounded-lg bg-white border border-ash-grey/30"
                initial="hidden"
                animate="visible"
                variants={fadeInUp}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-onyx font-mono">{v.key}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                    v.type === 'extracted'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {v.type}
                  </span>
                </div>
                <p className="text-xs text-dim-grey font-mono truncate">{v.value}</p>
              </motion.div>
            ))}
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
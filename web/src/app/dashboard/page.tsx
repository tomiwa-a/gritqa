'use client';

import { Folder, FileText, CheckCircle, Clock, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';

const stats = [
  {
    label: 'Total Projects',
    value: '6',
    supporting: '3 indexed this week',
    icon: Folder,
    iconBg: 'bg-space-indigo/8',
    iconColor: 'text-space-indigo',
    trend: null,
  },
  {
    label: 'Test Plans',
    value: '12',
    supporting: '4 need review',
    icon: FileText,
    iconBg: 'bg-punch-red/8',
    iconColor: 'text-punch-red',
    trend: null,
    badge: '4',
  },
  {
    label: 'Pass Rate',
    value: '94%',
    supporting: 'vs 92% last week',
    icon: CheckCircle,
    iconBg: 'bg-emerald/8',
    iconColor: 'text-emerald',
    trend: { value: '+2%', positive: true },
  },
  {
    label: 'Last Run',
    value: '2m ago',
    supporting: 'E2E Order Flow — 4/4 passed',
    icon: Clock,
    iconBg: 'bg-lavender-grey/8',
    iconColor: 'text-lavender-grey',
    trend: null,
  },
];

const recentExecutions = [
  { plan: 'E2E Order Flow', status: 'passed', duration: '1.2s', date: '2 min ago', steps: '4/4' },
  { plan: 'Auth Login', status: 'passed', duration: '0.8s', date: '5 min ago', steps: '3/3' },
  { plan: 'Payment Processing', status: 'failed', duration: '2.1s', date: '12 min ago', steps: '2/4' },
  { plan: 'User Registration', status: 'passed', duration: '0.6s', date: '1 hour ago', steps: '3/3' },
  { plan: 'API Rate Limiting', status: 'passed', duration: '0.4s', date: '2 hours ago', steps: '2/2' },
];

export default function DashboardOverview() {
  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-space-indigo tracking-tight">Overview</h1>
          <p className="text-sm text-lavender-grey mt-1">Your testing dashboard at a glance</p>
        </div>
        <button className="px-4 py-2 bg-punch-red text-white rounded-lg text-sm font-semibold hover:bg-classic-crimson transition-colors">
          New Test Plan
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-8">
        {['All Projects', 'Need Review', 'Failed', 'Recently Updated'].map((filter, i) => (
          <button
            key={filter}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              i === 0
                ? 'bg-space-indigo text-white'
                : 'text-lavender-grey hover:text-space-indigo hover:bg-platinum'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-lavender-grey/10 p-4 hover:border-lavender-grey/20 transition-colors"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className={`h-8 w-8 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
              </div>
              <span className="text-xs font-medium text-lavender-grey">{stat.label}</span>
              {stat.badge && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded bg-punch-red/10 text-punch-red">
                  {stat.badge}
                </span>
              )}
              {stat.trend && (
                <span className={`ml-auto flex items-center gap-0.5 text-xs font-semibold ${
                  stat.trend.positive ? 'text-emerald' : 'text-punch-red'
                }`}>
                  {stat.trend.positive ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {stat.trend.value}
                </span>
              )}
            </div>
            <p className="text-4xl font-bold text-space-indigo tracking-tight">{stat.value}</p>
            <p className="text-xs text-lavender-grey mt-1">{stat.supporting}</p>
          </div>
        ))}
      </div>

      {/* Recent executions */}
      <div className="bg-white rounded-xl border border-lavender-grey/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-lavender-grey/10 flex items-center justify-between">
          <h2 className="text-sm font-bold text-space-indigo">Recent Executions</h2>
          <button className="flex items-center gap-1 text-xs font-medium text-lavender-grey hover:text-space-indigo transition-colors">
            View all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-lavender-grey/10">
                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider">Plan</th>
                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider">Steps</th>
                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider">Duration</th>
                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-lavender-grey uppercase tracking-wider">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lavender-grey/10">
              {recentExecutions.map((exec) => (
                <tr key={exec.plan} className="hover:bg-platinum/50 transition-colors cursor-pointer">
                  <td className="px-5 py-3">
                    <span className="text-sm font-medium text-space-indigo">{exec.plan}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${
                      exec.status === 'passed'
                        ? 'bg-emerald/10 text-emerald'
                        : 'bg-punch-red/10 text-punch-red'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        exec.status === 'passed' ? 'bg-emerald' : 'bg-punch-red'
                      }`} />
                      {exec.status === 'passed' ? 'Passed' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm font-mono text-space-indigo">{exec.steps}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm text-lavender-grey">{exec.duration}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm text-lavender-grey">{exec.date}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
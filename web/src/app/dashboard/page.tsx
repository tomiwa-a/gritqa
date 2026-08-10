'use client';

import { Folder, FileText, CheckCircle, Clock, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';

const stats = [
  {
    label: 'Total Projects',
    value: '6',
    supporting: '3 indexed this week',
    icon: Folder,
    iconBg: 'bg-space-indigo/10',
    iconColor: 'text-space-indigo',
    trend: null,
  },
  {
    label: 'Test Plans',
    value: '12',
    supporting: '4 need review',
    icon: FileText,
    iconBg: 'bg-punch-red/10',
    iconColor: 'text-punch-red',
    trend: null,
    badge: '4',
    badgeColor: 'bg-punch-red text-white',
  },
  {
    label: 'Pass Rate',
    value: '94%',
    supporting: 'vs 92% last week',
    icon: CheckCircle,
    iconBg: 'bg-emerald/10',
    iconColor: 'text-emerald',
    trend: { value: '+2%', positive: true },
  },
  {
    label: 'Last Run',
    value: '2m ago',
    supporting: 'E2E Order Flow — 4/4 passed',
    icon: Clock,
    iconBg: 'bg-lavender-grey/10',
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
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-space-indigo">Overview</h1>
          <p className="text-lavender-grey mt-1">Your testing dashboard at a glance</p>
        </div>
        <button className="px-4 py-2.5 bg-punch-red text-platinum rounded-xl text-sm font-semibold hover:bg-classic-crimson transition-colors">
          New Test Plan
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {['All Projects', 'Need Review', 'Failed', 'Recently Updated'].map((filter, i) => (
          <button
            key={filter}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              i === 0
                ? 'bg-space-indigo text-white'
                : 'bg-white text-lavender-grey border border-lavender-grey/20 hover:border-lavender-grey/40 hover:text-space-indigo'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl border border-lavender-grey/15 p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`h-10 w-10 rounded-xl ${stat.iconBg} flex items-center justify-center`}>
                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
              </div>
              {stat.badge && (
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${stat.badgeColor}`}>
                  {stat.badge}
                </span>
              )}
              {stat.trend && (
                <span className={`flex items-center gap-0.5 text-xs font-semibold ${
                  stat.trend.positive ? 'text-emerald' : 'text-punch-red'
                }`}>
                  {stat.trend.positive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {stat.trend.value}
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-space-indigo tracking-tight">{stat.value}</p>
            <p className="text-sm text-lavender-grey mt-1">{stat.supporting}</p>
          </div>
        ))}
      </div>

      {/* Recent executions */}
      <div className="bg-white rounded-2xl border border-lavender-grey/15 overflow-hidden">
        <div className="px-6 py-4 border-b border-lavender-grey/15 flex items-center justify-between">
          <h2 className="text-lg font-bold text-space-indigo">Recent Executions</h2>
          <button className="flex items-center gap-1 text-sm font-medium text-lavender-grey hover:text-space-indigo transition-colors">
            View all
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-lavender-grey/15">
                <th className="text-left px-6 py-3 text-xs font-semibold text-lavender-grey uppercase tracking-wider">Plan</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-lavender-grey uppercase tracking-wider">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-lavender-grey uppercase tracking-wider">Steps</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-lavender-grey uppercase tracking-wider">Duration</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-lavender-grey uppercase tracking-wider">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lavender-grey/15">
              {recentExecutions.map((exec) => (
                <tr key={exec.plan} className="hover:bg-platinum/50 transition-colors cursor-pointer">
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-space-indigo">{exec.plan}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
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
                  <td className="px-6 py-4">
                    <span className="text-sm font-mono text-space-indigo">{exec.steps}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-lavender-grey">{exec.duration}</span>
                  </td>
                  <td className="px-6 py-4">
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
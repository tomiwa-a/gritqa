export default function TestPlansPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-space-indigo">Test Plans</h1>
          <p className="text-lavender-grey mt-1">Test plans for api project</p>
        </div>
        <button className="px-4 py-2.5 bg-punch-red text-platinum rounded-xl text-sm font-semibold hover:bg-classic-crimson transition-colors">
          New Test Plan
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-lavender-grey/15 overflow-hidden">
        <div className="px-6 py-4 border-b border-lavender-grey/15">
          <p className="text-sm font-medium text-space-indigo">5 test plans</p>
        </div>
        <div className="divide-y divide-lavender-grey/15">
          {[
            { name: 'E2E Order Flow', status: 'approved', lastRun: '2 min ago', passRate: '4/4' },
            { name: 'Auth Login', status: 'approved', lastRun: '5 min ago', passRate: '3/3' },
            { name: 'Payment Processing', status: 'review', lastRun: 'never', passRate: '-' },
            { name: 'User Registration', status: 'draft', lastRun: 'never', passRate: '-' },
            { name: 'API Rate Limiting', status: 'approved', lastRun: '1 hour ago', passRate: '2/2' },
          ].map((plan) => (
            <div key={plan.name} className="px-6 py-4 flex items-center justify-between hover:bg-platinum/50 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${
                  plan.status === 'approved' ? 'bg-green-500' :
                  plan.status === 'review' ? 'bg-yellow-500' :
                  'bg-lavender-grey/40'
                }`} />
                <span className="text-sm font-medium text-space-indigo">{plan.name}</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-lavender-grey">{plan.lastRun}</span>
                <span className="text-sm font-mono text-space-indigo">{plan.passRate}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  plan.status === 'approved' ? 'bg-green-100 text-green-700' :
                  plan.status === 'review' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-lavender-grey/20 text-lavender-grey'
                }`}>
                  {plan.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
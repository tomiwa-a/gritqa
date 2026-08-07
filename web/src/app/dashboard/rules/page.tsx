export default function RulesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-space-indigo">Testing Rules</h1>
          <p className="text-lavender-grey mt-1">Configure how GritQA generates tests</p>
        </div>
        <button className="px-4 py-2.5 bg-punch-red text-platinum rounded-xl text-sm font-semibold hover:bg-classic-crimson transition-colors">
          New Rule
        </button>
      </div>

      <div className="space-y-4">
        {[
          { name: 'Always test auth flows', desc: 'Include login, logout, and token refresh in every test suite', active: true },
          { name: 'Skip external APIs', desc: 'Mock all external API calls, never hit real endpoints', active: true },
          { name: 'Test error paths', desc: 'Include 4xx and 5xx error scenarios in test plans', active: true },
          { name: 'Max 10 steps per plan', desc: 'Keep test plans focused and under 10 steps', active: false },
        ].map((rule) => (
          <div key={rule.name} className="bg-white rounded-2xl border border-lavender-grey/15 p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                rule.active ? 'bg-green-100' : 'bg-lavender-grey/10'
              }`}>
                <span className={`text-lg ${rule.active ? 'text-green-600' : 'text-lavender-grey'}`}>
                  {rule.active ? '✓' : '○'}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-space-indigo">{rule.name}</p>
                <p className="text-sm text-lavender-grey">{rule.desc}</p>
              </div>
            </div>
            <button className={`w-12 h-6 rounded-full transition-colors ${
              rule.active ? 'bg-green-500' : 'bg-lavender-grey/30'
            }`}>
              <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${
                rule.active ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
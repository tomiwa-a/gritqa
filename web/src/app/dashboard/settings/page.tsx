export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-space-indigo">Settings</h1>
        <p className="text-lavender-grey mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6">
        {/* Profile */}
        <div className="bg-white rounded-2xl border border-lavender-grey/15 p-6">
          <h2 className="text-lg font-bold text-space-indigo mb-4">Profile</h2>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-16 w-16 rounded-full bg-space-indigo/10 flex items-center justify-center text-xl font-bold text-space-indigo">
              D
            </div>
            <div>
              <p className="font-semibold text-space-indigo">Demo User</p>
              <p className="text-sm text-lavender-grey">demo@gritqa.dev</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-space-indigo mb-1.5">Name</label>
              <input type="text" defaultValue="Demo User" className="w-full px-3 py-2 rounded-lg border border-lavender-grey/20 text-sm text-space-indigo focus:outline-none focus:border-punch-red transition-colors" />
            </div>
            <div>
              <label className="block text-sm font-medium text-space-indigo mb-1.5">Email</label>
              <input type="email" defaultValue="demo@gritqa.dev" className="w-full px-3 py-2 rounded-lg border border-lavender-grey/20 text-sm text-space-indigo focus:outline-none focus:border-punch-red transition-colors" />
            </div>
          </div>
        </div>

        {/* API Key */}
        <div className="bg-white rounded-2xl border border-lavender-grey/15 p-6">
          <h2 className="text-lg font-bold text-space-indigo mb-4">API Key</h2>
          <div className="flex items-center gap-3">
            <input type="password" defaultValue="gq_sk_xxxxxxxxxxxxxxxxxxxx" readOnly className="flex-1 px-3 py-2 rounded-lg border border-lavender-grey/20 bg-platinum text-sm text-space-indigo font-mono" />
            <button className="px-4 py-2 rounded-lg border border-lavender-grey/20 text-sm font-medium text-space-indigo hover:bg-platinum transition-colors">
              Copy
            </button>
          </div>
          <p className="text-xs text-lavender-grey mt-2">Used by the CLI to authenticate with your account</p>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-2xl border border-lavender-grey/15 p-6">
          <h2 className="text-lg font-bold text-space-indigo mb-4">Notifications</h2>
          <div className="space-y-4">
            {[
              { label: 'Email on test failure', checked: true },
              { label: 'Weekly summary', checked: false },
              { label: 'New test plan generated', checked: true },
            ].map((item) => (
              <label key={item.label} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked={item.checked} className="h-4 w-4 rounded border-lavender-grey/30 text-punch-red focus:ring-punch-red" />
                <span className="text-sm text-space-indigo">{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
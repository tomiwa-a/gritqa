export default function ProjectsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-space-indigo">Projects</h1>
          <p className="text-lavender-grey mt-1">Manage your codebase projects</p>
        </div>
        <button className="px-4 py-2.5 bg-punch-red text-platinum rounded-xl text-sm font-semibold hover:bg-classic-crimson transition-colors">
          New Project
        </button>
      </div>

      {/* Table placeholder */}
      <div className="bg-white rounded-2xl border border-lavender-grey/15 overflow-hidden">
        <div className="px-6 py-4 border-b border-lavender-grey/15">
          <p className="text-sm font-medium text-space-indigo">6 projects</p>
        </div>
        <div className="divide-y divide-lavender-grey/15">
          {[
            { name: 'api', branch: 'main', files: 1247, status: 'indexed' },
            { name: 'web', branch: 'feat/checkout', files: 892, status: 'indexed' },
            { name: 'cli', branch: 'main', files: 456, status: 'indexed' },
            { name: 'auth-service', branch: 'main', files: 312, status: 'stale' },
            { name: 'payments', branch: 'feat/refunds', files: 678, status: 'indexed' },
            { name: 'notifications', branch: 'main', files: 234, status: 'indexing' },
          ].map((project) => (
            <div key={project.name} className="px-6 py-4 flex items-center justify-between hover:bg-platinum/50 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-space-indigo">{project.name}</span>
                <span className="text-xs font-mono text-lavender-grey">{project.branch}</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-lavender-grey">{project.files.toLocaleString()} files</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  project.status === 'indexed' ? 'bg-green-100 text-green-700' :
                  project.status === 'stale' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {project.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
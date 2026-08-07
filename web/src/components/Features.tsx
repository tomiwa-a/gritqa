export default function Features() {
  const features = [
    {
      title: "Codebase Indexing",
      description:
        "Tree-sitter AST parsing maps your entire codebase — functions, classes, and dependencies.",
      code: `// Indexed symbols
CancelOrder()  → order_controller.go:45
CreateUser()   → user_controller.go:12
Order struct    → models/order.go:8`,
    },
    {
      title: "AI Test Generation",
      description:
        "Reads your actual source code and generates tests that make sense for your business logic.",
      code: `{
  "steps": [
    { "name": "Login", "method": "POST" },
    { "name": "Create Order", "method": "POST" },
    { "name": "Verify", "method": "GET" }
  ]
}`,
    },
    {
      title: "Real Database Testing",
      description:
        "Docker containers with tmpfs. Real isolation. No mocking your database layer.",
      icon: (
        <svg className="h-8 w-8 text-brick-ember" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      ),
    },
    {
      title: "Human Review First",
      description:
        "AI generates, you approve. Edit, tweak, then run. Never run tests you haven't seen.",
      icon: (
        <svg className="h-8 w-8 text-brick-ember" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="features" className="bg-ghost-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-onyx md:text-4xl">
            Built for real-world testing
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-dim-grey">
            Every feature designed to replace hours of manual test writing.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-ash-grey/30 bg-white p-6 transition-all hover:border-brick-ember/20 hover:shadow-lg hover:shadow-brick-ember/5"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brick-ember/10">
                {f.icon ?? (
                  <svg className="h-6 w-6 text-brick-ember" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                )}
              </div>
              <h3 className="mb-2 text-lg font-bold text-onyx">{f.title}</h3>
              <p className="mb-4 text-sm leading-relaxed text-dim-grey">
                {f.description}
              </p>
              {f.code && (
                <div className="rounded-lg bg-onyx p-4 font-mono text-xs leading-relaxed text-ash-grey">
                  <pre>
                    <code>{f.code}</code>
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

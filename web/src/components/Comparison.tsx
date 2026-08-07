export default function Comparison() {
  const rows = [
    {
      manual: "Write tests by hand",
      gritqa: "AI generates from code changes",
    },
    {
      manual: "Hours per endpoint",
      gritqa: "Seconds per change",
    },
    {
      manual: "Mock everything",
      gritqa: "Real Docker databases",
    },
    {
      manual: "Tests go stale",
      gritqa: "Tests evolve with your code",
    },
    {
      manual: "Manual trigger only",
      gritqa: "Git push triggers automatically",
    },
  ];

  return (
    <section className="bg-ghost-white py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-onyx md:text-4xl">
            Why GritQA vs. doing it manually
          </h2>
        </div>

        <div className="overflow-hidden rounded-2xl border border-ash-grey/30">
          <div className="grid grid-cols-2 bg-onyx text-sm font-bold text-ghost-white">
            <div className="px-6 py-4">Manual Testing</div>
            <div className="px-6 py-4">GritQA</div>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className={`grid grid-cols-2 text-sm ${
                i % 2 === 0 ? "bg-white" : "bg-ghost-white"
              }`}
            >
              <div className="flex items-center gap-3 px-6 py-4 text-dim-grey">
                <span className="text-[#c20114]">✗</span>
                {r.manual}
              </div>
              <div className="flex items-center gap-3 px-6 py-4 font-medium text-onyx">
                <span className="text-[#28c840]">✓</span>
                {r.gritqa}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

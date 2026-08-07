export default function TrustBlock() {
  const metrics = [
    { value: "< 5 min", label: "Push to results" },
    { value: "> 80%", label: "AI accuracy on first attempt" },
    { value: "100%", label: "Local execution" },
    { value: "0", label: "Lines of test code you write" },
  ];

  return (
    <section className="bg-onyx py-20 relative overflow-hidden">
      {/* Subtle background glow for depth */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-brick-ember/10 blur-[100px] rounded-full pointer-events-none" />
      
      <div className="mx-auto max-w-7xl px-6 relative z-10">
        <div className="grid grid-cols-2 gap-10 md:gap-8 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="text-center group">
              <p className="text-3xl font-bold text-ghost-white md:text-5xl tracking-tight transition-transform group-hover:scale-105 duration-300">
                {m.value}
              </p>
              <p className="mt-3 text-sm font-medium tracking-wide text-ash-grey/70">
                {m.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

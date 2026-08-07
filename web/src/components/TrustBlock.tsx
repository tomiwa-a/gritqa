export default function TrustBlock() {
  const metrics = [
    { value: "500+", label: "Projects Indexed" },
    { value: "98%", label: "Accuracy" },
    { value: "10K+", label: "Tests Run Locally" },
    { value: "4.8/5", label: "GitHub Rating" },
  ];

  return (
    <section className="border-b border-ash-grey/30 bg-ghost-white py-16">
      <div className="mx-auto max-w-6xl px-6">
        <p className="mb-10 text-center text-sm font-medium text-dim-grey">
          Trusted by backend developers worldwide
        </p>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="text-center">
              <p className="text-3xl font-extrabold text-brick-ember md:text-4xl">
                {m.value}
              </p>
              <p className="mt-1 text-sm text-dim-grey">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

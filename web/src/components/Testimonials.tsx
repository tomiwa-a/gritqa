export default function Testimonials() {
  const testimonials = [
    {
      quote:
        "Finally, a testing tool that reads my code instead of guessing from function names.",
      name: "Sarah Chen",
      title: "Senior Backend Engineer",
    },
    {
      quote:
        "We cut our test writing time by 70%. The AI actually understands our business logic.",
      name: "Marcus Rodriguez",
      title: "CTO, BuildFast",
    },
    {
      quote:
        "Running tests against real Docker databases instead of mocks caught 3 bugs we missed for months.",
      name: "Aisha Patel",
      title: "Lead Developer",
    },
  ];

  return (
    <section className="border-t border-ash-grey/30 bg-ghost-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-onyx md:text-4xl">
            Loved by backend engineers
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl border border-ash-grey/30 bg-white p-6"
            >
              <p className="mb-6 text-sm leading-relaxed text-onyx">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brick-ember/10 text-sm font-bold text-brick-ember">
                  {t.name[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-onyx">{t.name}</p>
                  <p className="text-xs text-dim-grey">{t.title}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-onyx">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(194,1,20,0.15),_transparent_70%)]" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to_right, #c7d6d5 1px, transparent 1px), linear-gradient(to_bottom, #c7d6d5 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center md:py-32">
        <div className="mb-8 inline-flex items-center gap-1.5 rounded-full border border-ash-grey/20 bg-ghost-white/5 px-3 py-1 text-xs font-medium text-ash-grey">
          <span className="text-brick-ember">✦</span>
          Open Source & Free
        </div>

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-tight text-ghost-white md:text-6xl">
          Stop writing tests.
          <br />
          Let{" "}
          <span className="bg-gradient-to-r from-brick-ember to-[#e84545] bg-clip-text text-transparent">
            AI read your code
          </span>
          .
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ash-grey md:text-lg">
          GritQA analyzes your codebase, generates test plans from what actually
          changed, and runs them against real databases — all on your machine.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#get-started"
            className="rounded-full bg-brick-ember px-6 py-3 text-sm font-semibold text-ghost-white transition-all hover:bg-brick-ember/90 hover:shadow-lg hover:shadow-brick-ember/30"
          >
            Start Testing Free →
          </a>
          <a
            href="#docs"
            className="rounded-full border border-ash-grey/30 px-6 py-3 text-sm font-semibold text-ash-grey transition-all hover:border-ghost-white/40 hover:text-ghost-white"
          >
            View Docs
          </a>
        </div>

        <div className="mx-auto mt-16 max-w-2xl rounded-xl border border-ash-grey/10 bg-onyx/80 p-6 text-left font-mono text-sm shadow-2xl shadow-black/40">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <div className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs text-dim-grey">Terminal</span>
          </div>
          <div className="space-y-1.5 text-ash-grey">
            <p>
              <span className="text-brick-ember">$</span> gritqa
            </p>
            <p>
              <span className="text-[#28c840]">✓</span> Indexing
              codebase... (1,247 files)
            </p>
            <p>
              <span className="text-[#28c840]">✓</span> Detected 3 changed
              files
            </p>
            <p>
              <span className="text-[#28c840]">✓</span> Generating test
              plan...
            </p>
            <p className="pt-2 text-ghost-white">Test Plan: E2E Order Flow</p>
            <p className="pl-4">
              ├── Step 1: Login (POST /auth/login)
              <span className="ml-2 text-[#28c840]">✓ PASS</span>
            </p>
            <p className="pl-4">
              ├── Step 2: Create Order (POST /orders)
              <span className="ml-2 text-[#28c840]">✓ PASS</span>
            </p>
            <p className="pl-4">
              ├── Step 3: Verify Order (GET /orders/:id)
              <span className="ml-2 text-[#28c840]">✓ PASS</span>
            </p>
            <p className="pl-4">
              └── Step 4: Cleanup (DELETE /orders/:id)
              <span className="ml-2 text-[#28c840]">✓ PASS</span>
            </p>
            <p className="pt-2 text-dim-grey">
              4/4 passed · 1.2s · 0 failed
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

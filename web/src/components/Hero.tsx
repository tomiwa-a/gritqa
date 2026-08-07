export default function Hero() {
  return (
    <section className="bg-ghost-white py-24 md:py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left Column — Text & CTA */}
        <div className="max-w-2xl">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] text-onyx">
            AI-powered backend testing that reads your code.
          </h1>
          
          <p className="mt-6 text-lg md:text-xl text-dim-grey leading-relaxed">
            GritQA indexes your codebase, generates test plans from what actually
            changed, and runs them against real Docker databases — all on your
            machine.
          </p>

          <form className="mt-10 flex flex-col sm:flex-row items-center gap-3 sm:gap-0">
            <input
              type="email"
              placeholder="Enter your email"
              className="w-full sm:w-72 border border-ash-grey/50 sm:rounded-l-full sm:rounded-r-none rounded-full px-6 py-4 text-sm bg-white placeholder:text-dim-grey focus:outline-none focus:border-brick-ember transition-colors shadow-sm"
            />
            <button
              type="submit"
              className="w-full sm:w-auto bg-brick-ember text-ghost-white sm:rounded-r-full sm:rounded-l-none rounded-full px-8 py-4 text-sm font-semibold hover:bg-brick-ember/90 transition-colors shadow-sm"
            >
              Join Waitlist →
            </button>
          </form>
          
          <p className="mt-4 text-sm text-dim-grey/80">
            Join 1,200+ engineers ending manual test writing.
          </p>
        </div>

        {/* Right Column — Terminal */}
        <div className="relative w-full max-w-2xl mx-auto lg:mx-0">
          {/* Decorative backdrop glow to make it less basic */}
          <div className="absolute -inset-1 bg-gradient-to-tr from-brick-ember/10 to-ash-grey/20 rounded-2xl blur-xl" />
          
          <div className="relative rounded-xl border border-ash-grey/40 bg-white overflow-hidden shadow-xl shadow-onyx/5">
            {/* Title bar */}
            <div className="px-4 py-3 border-b border-ash-grey/30 flex items-center gap-2 bg-ghost-white/80">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-xs text-dim-grey font-mono">
                bash
              </span>
            </div>

            {/* Body */}
            <div className="p-6 font-mono text-sm leading-relaxed text-onyx bg-ghost-white/30 overflow-x-auto">
              <pre className="whitespace-pre-wrap">
                <span className="text-dim-grey">$ </span>gritqa{"\n"}
                <span className="text-[#16a34a]">✓</span> Indexing codebase...{" "}
                (1,247 files){"\n"}
                <span className="text-[#16a34a]">✓</span> Detected 3 changed
                files{"\n"}
                <span className="text-[#16a34a]">✓</span> Generating test plan...
                {"\n"}
                {"\n"}
                Test Plan: E2E Order Flow{"\n"}
                {"  "}├── Step 1: Login (POST /auth/login){"       "}
                <span className="text-[#16a34a]">✓ PASS</span>
                {"\n"}
                {"  "}├── Step 2: Create Order (POST /orders){"     "}
                <span className="text-[#16a34a]">✓ PASS</span>
                {"\n"}
                {"  "}├── Step 3: Verify (GET /orders/:id){"        "}
                <span className="text-[#16a34a]">✓ PASS</span>
                {"\n"}
                {"  "}└── Step 4: Cleanup (DELETE /orders/:id){"    "}
                <span className="text-[#16a34a]">✓ PASS</span>
                {"\n"}
                {"\n"}
                <span className="text-dim-grey">
                  4/4 passed · 1.2s · 0 failed
                </span>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

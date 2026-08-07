export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-ghost-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-onyx">
            How GritQA works
          </h2>
          <p className="text-dim-grey mt-4 text-lg">
            Three steps from code change to confident deployments.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 mt-16">
          {/* Step 1 */}
          <div className="relative group rounded-3xl border border-ash-grey/30 bg-white p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ghost-white font-mono text-lg font-bold text-brick-ember shadow-sm">
                  01
                </span>
                <h3 className="text-xl font-bold text-onyx">Push your code</h3>
              </div>
              <p className="text-base text-dim-grey leading-relaxed mt-5">
                GritQA detects what changed via git diff and maps affected functions
                using Tree-sitter AST parsing.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-ghost-white/50 p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-inner">
                <span className="text-dim-grey">$</span> git push origin main{"\n"}
                <span className="text-brick-ember/80">→</span> 3 files changed{"\n"}
                <span className="text-brick-ember/80">→</span> order_controller.go (L84){"\n"}
                <span className="text-brick-ember/80">→</span> payment_service.go (L112){"\n"}
                <span className="text-brick-ember/80">→</span> models/order.go (L8)
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative group rounded-3xl border border-ash-grey/30 bg-white p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden lg:mt-8">
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ghost-white font-mono text-lg font-bold text-brick-ember shadow-sm">
                  02
                </span>
                <h3 className="text-xl font-bold text-onyx">AI generates tests</h3>
              </div>
              <p className="text-base text-dim-grey leading-relaxed mt-5">
                Readable test plans with HTTP requests, variable extraction, and
                assertions — generated from your actual source code.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-ghost-white/50 p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-inner">
                <span className="text-brick-ember/80">steps:</span>{"\n"}
                {"  "}- <span className="text-dim-grey">name:</span> &quot;Login&quot;{"\n"}
                {"    "}POST /auth/login{"\n"}
                {"    "}<span className="text-brick-ember/80">extract:</span> authToken{"\n"}
                {"  "}- <span className="text-dim-grey">name:</span> &quot;Create Order&quot;{"\n"}
                {"    "}POST /orders{"\n"}
                {"    "}<span className="text-brick-ember/80">assert:</span> status == 201
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative group rounded-3xl border border-ash-grey/30 bg-white p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden lg:mt-16">
            <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ghost-white font-mono text-lg font-bold text-brick-ember shadow-sm">
                  03
                </span>
                <h3 className="text-xl font-bold text-onyx">Run tests locally</h3>
              </div>
              <p className="text-base text-dim-grey leading-relaxed mt-5">
                Tests execute inside ephemeral Docker containers with real PostgreSQL.
                Full isolation, instant teardown.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-ghost-white/50 p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-inner">
                <span className="text-[#16a34a]">✓</span> Container started (240ms){"\n"}
                <span className="text-[#16a34a]">✓</span> Migrations applied{"\n"}
                <span className="text-[#16a34a]">✓</span> 4/4 tests passed{"\n"}
                <span className="text-[#16a34a]">✓</span> Container destroyed{"\n"}
                <span className="text-dim-grey mt-2 block">Total: 1.18s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

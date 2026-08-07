export default function Features() {
  return (
    <section id="features" className="border-t border-ash-grey/20 bg-white py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-onyx">
            Built for real-world backend testing
          </h2>
          <p className="text-dim-grey mt-4 text-lg">
            Every feature designed to replace hours of manual test writing.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 mt-16">
          {/* Feature 1 */}
          <div className="group relative rounded-3xl border border-ash-grey/30 bg-ghost-white/50 p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <h3 className="text-xl md:text-2xl font-bold text-onyx">Codebase Indexing</h3>
              <p className="text-base text-dim-grey leading-relaxed mt-3 max-w-md">
                Tree-sitter AST parsing maps your entire codebase — functions,
                classes, routes, and dependency chains.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-white p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-sm">
                <span className="text-dim-grey">Indexed symbols:</span>{"\n"}
                CreateOrder()  <span className="text-brick-ember/80">→</span> order_controller.go:45{"\n"}
                ProcessPayment() <span className="text-brick-ember/80">→</span> payment_service.go:12{"\n"}
                Order struct   <span className="text-brick-ember/80">→</span> models/order.go:8{"\n"}
                <span className="text-dim-grey mt-2 block">Dependencies:  3 affected endpoints</span>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="group relative rounded-3xl border border-ash-grey/30 bg-ghost-white/50 p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <h3 className="text-xl md:text-2xl font-bold text-onyx">AI Test Generation</h3>
              <p className="text-base text-dim-grey leading-relaxed mt-3 max-w-md">
                Tests generated from what actually changed — not blind boilerplate.
                AI reads your source code and drafts structured test plans.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-white p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-sm">
                <span className="text-brick-ember/80">{"{"}</span>{"\n"}
                {"  "}&quot;name&quot;: &quot;Order Flow&quot;,{"\n"}
                {"  "}&quot;steps&quot;: [{"\n"}
                {"    "}{"{"} &quot;POST /auth/login&quot;, extract: &quot;token&quot; {"},"}{"\n"}
                {"    "}{"{"} &quot;POST /orders&quot;, assert: &quot;status == 201&quot; {"},"}{"\n"}
                {"    "}{"{"} &quot;GET /orders/:id&quot;, assert: &quot;body.status&quot; {"}"}{"\n"}
                {"  "}]{"\n"}
                <span className="text-brick-ember/80">{"}"}</span>
              </div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="group relative rounded-3xl border border-ash-grey/30 bg-ghost-white/50 p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <h3 className="text-xl md:text-2xl font-bold text-onyx">Real Database Testing</h3>
              <p className="text-base text-dim-grey leading-relaxed mt-3 max-w-md">
                Docker containers with tmpfs RAM storage. Real PostgreSQL with real
                constraints, indexes, and foreign keys. Zero data contamination.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-white p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-sm">
                <span className="text-dim-grey">Container:</span> postgres:16-alpine{"\n"}
                <span className="text-dim-grey">Storage:</span>   tmpfs (RAM){"\n"}
                <span className="text-dim-grey">Boot:</span>      <span className="text-[#16a34a]">210ms</span>{"\n"}
                <span className="text-dim-grey">Teardown:</span>  <span className="text-[#16a34a]">instant</span>{"\n"}
                <span className="text-dim-grey">Isolation:</span> complete
              </div>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="group relative rounded-3xl border border-ash-grey/30 bg-ghost-white/50 p-8 md:p-10 transition-all hover:border-brick-ember/40 hover:shadow-xl hover:shadow-brick-ember/5 overflow-hidden">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-brick-ember/5 blur-3xl transition-all group-hover:bg-brick-ember/10" />
            <div className="relative z-10">
              <h3 className="text-xl md:text-2xl font-bold text-onyx">Human Review</h3>
              <p className="text-base text-dim-grey leading-relaxed mt-3 max-w-md">
                AI generates, you approve. Review every test plan step before
                execution. Edit assertions, tweak payloads, or reject entirely.
              </p>
              <div className="mt-8 rounded-xl border border-ash-grey/20 bg-white p-5 font-mono text-xs md:text-sm text-onyx leading-relaxed shadow-sm">
                <span className="text-dim-grey">Status:</span> DRAFT → REVIEW → <span className="text-[#16a34a]">APPROVED</span>{"\n"}
                {"\n"}
                Step 1: Login       <span className="text-[#16a34a]">[✓ approved]</span>{"\n"}
                Step 2: Create Order <span className="text-[#16a34a]">[✓ approved]</span>{"\n"}
                Step 3: Verify DB    <span className="text-brick-ember/80">[✎ edited]</span>{"\n"}
                Step 4: Cleanup      <span className="text-[#16a34a]">[✓ approved]</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

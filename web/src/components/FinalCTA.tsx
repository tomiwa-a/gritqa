export default function FinalCTA() {
  return (
    <section className="bg-ghost-white py-24 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="relative rounded-3xl bg-onyx px-6 py-20 text-center overflow-hidden shadow-2xl shadow-onyx/10 border border-ash-grey/20">
          {/* Subtle background glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brick-ember/20 via-onyx to-onyx opacity-60" />
          
          <div className="relative z-10">
            <h2 className="text-3xl font-bold tracking-tight text-ghost-white md:text-5xl">
              Ready to stop writing tests manually?
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg text-ash-grey/80">
              Join the waitlist. GritQA is open source and free.
            </p>
            <form className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-0">
              <input
                type="email"
                placeholder="you@company.com"
                className="w-full sm:w-72 rounded-full sm:rounded-r-none sm:rounded-l-full border border-ash-grey/20 bg-white/5 px-6 py-4 text-sm text-ghost-white placeholder-ash-grey/50 focus:border-brick-ember focus:outline-none backdrop-blur-sm transition-colors hover:bg-white/10"
              />
              <button
                type="submit"
                className="w-full sm:w-auto rounded-full sm:rounded-l-none sm:rounded-r-full bg-brick-ember px-8 py-4 text-sm font-semibold text-ghost-white hover:bg-brick-ember/90 shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                Join Waitlist →
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

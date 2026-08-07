export default function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-onyx py-24">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(194,1,20,0.2),_transparent_70%)]" />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ghost-white md:text-4xl">
          Ready to stop writing tests manually?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-ash-grey">
          Join hundreds of backend developers who let AI handle test generation.
          Open source, free forever.
        </p>
        <a
          href="#get-started"
          className="mt-10 inline-block rounded-full bg-brick-ember px-8 py-4 text-sm font-semibold text-ghost-white transition-all hover:bg-brick-ember/90 hover:shadow-lg hover:shadow-brick-ember/30"
        >
          Start Testing Free →
        </a>
      </div>
    </section>
  );
}

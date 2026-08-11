import { Navbar } from '@/components/sections/navbar';
import { Hero } from '@/components/sections/hero';
import { Features } from '@/components/sections/features';
import { HowItWorks } from '@/components/sections/how-it-works';
import { Spec } from '@/components/sections/spec';
import { Waitlist } from '@/components/sections/waitlist';
import { Footer } from '@/components/sections/footer';

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Spec />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}

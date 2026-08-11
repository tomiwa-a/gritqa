import { Navbar } from '@/components/sections/navbar';
import { Hero } from '@/components/sections/hero';
import { Pillars } from '@/components/sections/pillars';
import { HowItWorks } from '@/components/sections/how-it-works';
import { Personas } from '@/components/sections/personas';
import { Waitlist } from '@/components/sections/waitlist';
import { Footer } from '@/components/sections/footer';

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <Pillars />
        <HowItWorks />
        <Personas />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}

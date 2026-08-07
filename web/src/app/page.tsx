import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import TrustBlock from "@/components/TrustBlock";
import HowItWorks from "@/components/HowItWorks";
import Features from "@/components/Features";
import CodePreview from "@/components/CodePreview";
import Comparison from "@/components/Comparison";
import Testimonials from "@/components/Testimonials";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <TrustBlock />
        <HowItWorks />
        <Features />
        <CodePreview />
        <Comparison />
        <Testimonials />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

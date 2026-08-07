'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Star, CheckCircle, FolderGit2, Zap } from 'lucide-react';
import { fadeInUp, fadeIn, staggerContainer, slideInRight, buttonHover, buttonTap } from '@/lib/animations';
import ProductMockup from './ProductMockup';

export default function Hero() {
  return (
    <section className="relative bg-ghost-white py-20 md:py-32 lg:py-40 overflow-hidden">
      {/* Subtle background color block on left */}
      <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-[rgba(194,1,20,0.03)]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left Column — Text & CTA */}
          <motion.div
            className="max-w-2xl pt-8 lg:pt-16 z-10"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {/* Eyebrow Badge */}
            <motion.div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ash-grey/30 bg-white/80 backdrop-blur-sm text-sm font-medium text-dim-grey mb-8"
              variants={fadeInUp}
            >
              <Sparkles className="h-4 w-4 text-brick-ember" />
              <span>Open Source & Free</span>
              <ArrowRight className="h-4 w-4 text-brick-ember" />
            </motion.div>

            {/* Headline with gradient text on key words */}
            <motion.h1
              className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight leading-[1.05] text-onyx"
              variants={fadeInUp}
            >
              <span className="text-brick-ember">AI</span>-powered backend testing that{' '}
              <span className="text-brick-ember">reads your code</span>.
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              className="mt-6 text-lg md:text-xl text-dim-grey leading-relaxed max-w-xl"
              variants={fadeInUp}
            >
              GritQA indexes your codebase, generates test plans from what actually
              changed, and runs them against real Docker databases — all on your machine.
            </motion.p>

            {/* CTAs */}
            <motion.div
              className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4"
              variants={fadeInUp}
            >
              <motion.button
                className="flex items-center gap-2 px-8 py-4 bg-brick-ember text-ghost-white rounded-full text-sm font-semibold hover:bg-brick-ember/90 transition-colors shadow-sm shadow-brick-ember/20 whitespace-nowrap"
                whileHover="hover"
                whileTap="tap"
                variants={{ hover: buttonHover, tap: buttonTap }}
              >
                Start Testing Free
                <ArrowRight className="h-4 w-4" />
              </motion.button>
              <motion.button
                className="flex items-center gap-2 px-8 py-4 border border-ash-grey/30 text-onyx rounded-full text-sm font-semibold hover:bg-ash-grey/50 hover:border-ash-grey/50 transition-colors whitespace-nowrap"
                whileHover="hover"
                whileTap="tap"
                variants={{ hover: buttonHover, tap: buttonTap }}
              >
                View Docs
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </motion.div>

            {/* Stats Bar */}
            <motion.div
              className="mt-10 flex flex-wrap items-center gap-8 text-sm font-mono text-dim-grey"
              variants={fadeInUp}
            >
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-brick-ember" />
                <span>1.2K GitHub stars</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>10K+ tests generated</span>
              </div>
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-4 w-4 text-blue-600" />
                <span>500+ projects indexed</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                <span>~2min setup</span>
              </div>
            </motion.div>
          </motion.div>

          {/* Right Column — Product Mockup */}
          <motion.div
            className="relative w-full max-w-3xl mx-auto lg:mx-0 z-10"
            initial="hidden"
            animate="visible"
            variants={slideInRight}
          >
            <ProductMockup />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
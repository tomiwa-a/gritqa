'use client';

import { ChevronDown, Bell } from 'lucide-react';

export default function Header() {
  return (
    <header className="h-16 border-b border-lavender-grey/15 bg-white flex items-center justify-between px-6">
      {/* Left — project selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-lavender-grey/20 bg-platinum hover:bg-lavender-grey/10 transition-colors cursor-pointer">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="text-sm font-medium text-space-indigo">api</span>
          <ChevronDown className="h-4 w-4 text-lavender-grey" />
        </div>
        <span className="hidden sm:inline text-sm text-lavender-grey">/</span>
        <span className="hidden sm:inline text-sm text-lavender-grey font-mono">main</span>
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-4">
        <button className="relative p-2 rounded-lg text-lavender-grey hover:text-space-indigo hover:bg-platinum transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-punch-red" />
        </button>
        <div className="h-8 w-8 rounded-full bg-space-indigo/10 flex items-center justify-center text-sm font-bold text-space-indigo">
          D
        </div>
      </div>
    </header>
  );
}
import React from 'react';
import './Brutalista.css';
import { ArrowRight, Smartphone } from 'lucide-react';

export function Brutalista() {
  return (
    <div className="brutalista-root min-h-screen bg-brutal-paper text-brutal-black font-space relative overflow-hidden p-6 md:p-12">
      {/* Huge Red Circle Backdrop */}
      <div className="absolute top-[-10vw] right-[-10vw] w-[60vw] h-[60vw] rounded-full bg-brutal-red opacity-90 mix-blend-multiply pointer-events-none hidden md:block"></div>
      
      {/* Small stacked color-chip squares */}
      <div className="absolute top-12 left-12 flex flex-col gap-1 z-20">
        <div className="w-4 h-4 bg-brutal-teal"></div>
        <div className="w-4 h-4 bg-brutal-pink"></div>
        <div className="w-4 h-4 bg-brutal-orange"></div>
      </div>

      <div className="max-w-7xl mx-auto relative z-10 grid grid-cols-1 md:grid-cols-12 gap-8 mt-12 md:mt-24">
        
        {/* Header / Brand */}
        <header className="md:col-span-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b-4 border-brutal-black pb-4 mb-8">
          <div>
            <h1 className="font-syne text-6xl md:text-8xl font-extrabold tracking-tighter leading-none">
              V <span className="text-brutal-red">[]</span> I D
            </h1>
            <p className="font-syne text-xl md:text-2xl mt-2 font-bold tracking-tight uppercase">
              Conversations belong to the people having them.
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <div className="inline-block bg-brutal-black text-brutal-paper px-3 py-1 font-bold text-sm">OPEN BETA · v0.6</div>
          </div>
        </header>

        {/* Left Column: Hero Text */}
        <div className="md:col-span-7 flex flex-col justify-center">
          <div className="relative">
            {/* Glitch Strip */}
            <div className="absolute top-1/2 left-[-10vw] w-[120%] h-6 bg-brutal-teal opacity-50 mix-blend-multiply -translate-y-1/2 -rotate-2 pointer-events-none"></div>
            
            <h2 className="font-syne text-5xl md:text-7xl font-bold leading-[0.9] tracking-tighter uppercase relative z-10">
              Send anyone a link.<br/>
              They click. You talk.<br/>
              <span className="text-brutal-red bg-brutal-paper px-2">The room burns down.</span>
            </h2>
          </div>

          <div className="mt-8">
            <p className="text-lg md:text-xl font-bold bg-brutal-green text-brutal-paper inline-block px-4 py-2">
              Ephemeral rooms · opens from a link, no install · up to 4 people
            </p>
          </div>
          
          <div className="mt-12 flex flex-col md:flex-row gap-4">
            <button className="font-syne font-bold text-xl px-8 py-4 bg-brutal-red text-brutal-paper border-4 border-brutal-red hover:bg-brutal-paper hover:text-brutal-red transition-colors uppercase tracking-widest flex items-center justify-center gap-2 group cursor-pointer">
              Host a Room <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </button>
            <button className="font-syne font-bold text-xl px-8 py-4 bg-transparent text-brutal-black border-4 border-brutal-black hover:bg-brutal-black hover:text-brutal-paper transition-colors uppercase tracking-widest cursor-pointer">
              Join a Room
            </button>
          </div>
          
          <div className="mt-6">
            <button className="text-sm font-bold underline underline-offset-4 decoration-2 hover:text-brutal-red uppercase cursor-pointer">
              Recover Previous Session
            </button>
          </div>
        </div>

        {/* Right Column: Editorial Notes & Graphics */}
        <div className="md:col-span-5 relative mt-12 md:mt-0">
          <div className="md:absolute right-0 top-0 w-full md:w-5/6">
            {/* Diagonal Stepped Blocks */}
            <div className="w-full aspect-square relative bg-brutal-black text-brutal-paper p-8 flex flex-col justify-end border-4 border-brutal-black">
              <div className="absolute top-4 left-4 text-xs font-bold text-brutal-pink">FIG. 01</div>
              <p className="font-syne text-2xl md:text-3xl font-bold leading-tight relative z-10">
                "No action is required to protect your privacy here. Privacy is the default."
              </p>
              
              {/* Overlapping offset square */}
              <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-brutal-pink border-4 border-brutal-black -z-10 mix-blend-multiply"></div>
            </div>
          </div>
          
          {/* Editorial Annotations */}
          <div className="mt-16 md:mt-[120%] flex flex-col gap-6">
            <div className="flex gap-4 items-start">
              <span className="text-brutal-red font-bold font-syne text-xl">A.</span>
              <p className="text-sm border-l-2 border-brutal-red pl-4">
                P2P Encrypted. Data flows directly between peers.
              </p>
            </div>
            <div className="flex gap-4 items-start">
              <span className="text-brutal-red font-bold font-syne text-xl">B.</span>
              <p className="text-sm border-l-2 border-brutal-red pl-4">
                No accounts. No identities. Absolute anonymity.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer area */}
      <footer className="max-w-7xl mx-auto mt-24 md:mt-32 pt-8 border-t-4 border-brutal-black pb-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
          <div className="flex flex-wrap gap-4 md:gap-8 font-bold text-sm uppercase">
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors">Why VOID</a>
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors">Compare</a>
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors">Threat Model</a>
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors">Pricing</a>
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors">Limits</a>
            <a href="#" className="hover:bg-brutal-black hover:text-brutal-paper px-2 py-1 transition-colors text-brutal-teal">TOR</a>
          </div>
          
          <div className="bg-brutal-teal text-brutal-paper p-4 w-full md:w-auto border-4 border-brutal-black">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5" />
              <div>
                <p className="font-bold text-xs uppercase mb-1">Install VOID as an App</p>
                <p className="text-xs">Click "Add to Home Screen" in your browser menu.</p>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

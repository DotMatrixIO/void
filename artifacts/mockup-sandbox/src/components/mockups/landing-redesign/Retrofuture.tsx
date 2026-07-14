import React from 'react';
import { ArrowRight, Key, Shield, ShieldCheck, Zap } from 'lucide-react';
import './_retrofuture.css';

export function Retrofuture() {
  return (
    <div className="retrofuture-root min-h-[100dvh] rf-font-sans text-[#5b656b] bg-[#e2e5e7] relative overflow-hidden selection:bg-[#e8276f] selection:text-white">
      <div className="rf-bg-noise"></div>

      {/* Floating Mint Blocks Background */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[800px] rf-block-texture -rotate-6 z-0 opacity-80 blur-[2px]"></div>
      <div className="absolute top-1/2 right-1/4 w-[400px] h-[500px] rf-block-texture rotate-12 z-0 opacity-60"></div>

      <div className="max-w-7xl mx-auto px-8 py-12 relative z-10 flex flex-col min-h-screen">
        
        {/* Header */}
        <header className="flex items-start justify-between mb-16">
          <div>
            <h1 className="rf-font-display font-bold text-6xl tracking-tight text-[#1a1c1e] rf-duotone-glow mb-4">
              V <span className="font-light text-[#e8276f] opacity-80">[]</span> I D
            </h1>
            <p className="rf-font-mono text-sm uppercase tracking-widest text-[#5b656b] flex items-center gap-3">
              <span className="rf-dot"></span>
              open beta · v0.6
            </p>
          </div>
          
          <div className="text-right max-w-xs hidden md:block">
            <p className="rf-font-mono text-sm leading-relaxed text-[#5b656b]">
              "Conversations belong to the people having them."
            </p>
          </div>
        </header>

        {/* The Slash */}
        <div className="rf-slash mb-24 transform -skew-x-12 relative">
          <div className="absolute -top-3 right-24 w-8 h-8 bg-[#e2e5e7] rounded-full border-4 border-[#d9382e]"></div>
        </div>

        {/* Main Content */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-center mb-24">
          
          {/* Left: Tagline & Kicker */}
          <div className="col-span-1 lg:col-span-7">
            <h2 className="rf-font-display text-5xl md:text-7xl font-bold leading-[1.1] text-[#1a1c1e] mb-8">
              Send anyone a link.<br/>
              <span className="rf-duotone-text">They click. You talk.</span><br/>
              The room burns down.
            </h2>
            
            <p className="rf-font-mono text-lg md:text-xl text-[#5b656b] flex items-center gap-4 mb-12">
              <Zap className="w-5 h-5 text-[#ff7b00]" />
              Ephemeral rooms · opens from a link, no install · up to 4 people
            </p>

            <div className="p-6 border border-[#5b656b]/20 bg-[#e2e5e7]/50 backdrop-blur-sm max-w-xl inline-flex items-start gap-4">
              <ShieldCheck className="w-6 h-6 text-[#5c20d0] shrink-0 mt-1" />
              <p className="rf-font-sans text-base leading-relaxed text-[#1a1c1e]">
                No action is required to protect your privacy here. <strong className="font-bold text-[#e8276f]">Privacy is the default.</strong>
              </p>
            </div>
          </div>

          {/* Right: Controls Block */}
          <div className="col-span-1 lg:col-span-5">
            <div className="bg-[#1a1c1e] p-8 md:p-10 shadow-2xl relative">
              <div className="absolute top-0 right-0 w-16 h-16 bg-[#a3c9c7] mix-blend-exclusion"></div>
              <div className="absolute bottom-0 left-0 w-2 h-24 bg-[#ff7b00]"></div>
              
              <h3 className="rf-font-mono text-[#a3c9c7] text-sm uppercase tracking-widest mb-8 border-b border-[#a3c9c7]/30 pb-4">
                Room Controls //
              </h3>

              <div className="space-y-4">
                <button className="w-full rf-btn-duotone py-5 px-6 flex items-center justify-between group overflow-hidden">
                  <span className="rf-font-display font-bold text-xl tracking-wide relative z-10">HOST A ROOM</span>
                  <ArrowRight className="w-6 h-6 transform group-hover:translate-x-2 transition-transform relative z-10" />
                </button>
                
                <button className="w-full bg-transparent border border-[#5b656b] hover:border-[#a3c9c7] hover:bg-[#a3c9c7]/10 text-[#e2e5e7] py-5 px-6 flex items-center justify-between transition-colors">
                  <span className="rf-font-display font-bold text-xl tracking-wide">JOIN A ROOM</span>
                  <div className="w-6 h-6 border-2 border-current rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-current rounded-full"></div>
                  </div>
                </button>
                
                <button className="w-full bg-[#2a2c2e] hover:bg-[#3a3c3e] text-[#9ebdb6] py-4 px-6 flex items-center justify-center gap-3 transition-colors">
                  <Key className="w-4 h-4" />
                  <span className="rf-font-mono text-sm uppercase tracking-wider">Recover Session</span>
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-[#5b656b]/30">
                <p className="rf-font-mono text-xs text-[#5b656b] uppercase tracking-wider leading-relaxed">
                  Install void as an app:<br/>
                  <span className="text-[#a3c9c7]">Click "Add to Home Screen"</span>
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-auto border-t-2 border-[#1a1c1e] pt-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-wrap gap-6 items-center">
            {['WHY VOID', 'COMPARE', 'THREAT MODEL', 'PRICING', 'LIMITS', 'TOR'].map((link) => (
              <a key={link} href="#" className="rf-font-mono text-xs uppercase tracking-widest text-[#1a1c1e] hover:text-[#e8276f] transition-colors relative group">
                {link}
                <span className="absolute -bottom-2 left-0 w-0 h-0.5 bg-[#e8276f] transition-all group-hover:w-full"></span>
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="rf-dot w-2 h-2 bg-[#5c20d0]"></span>
            <span className="rf-font-mono text-[10px] uppercase tracking-widest text-[#5b656b]">system online</span>
          </div>
        </footer>

      </div>
    </div>
  );
}
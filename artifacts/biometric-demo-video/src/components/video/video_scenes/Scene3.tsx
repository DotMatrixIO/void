// SPDX-License-Identifier: AGPL-3.0-or-later
import { motion } from 'framer-motion';

/* Frozen scan-box remnants that persist from Scene2 and fade out during this scene.
   This gives the peak-contrast poster frame: scan context + thesis caption visible
   simultaneously at ~12–13 s into the video. */
function FrozenScanRemnants() {
  return (
    <motion.div
      className="absolute inset-0 flex pointer-events-none"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 2.5, ease: 'easeOut' }}
    >
      {/* Left pane: captured result frozen */}
      <div className="w-1/2 h-full relative">
        {/* Face capture box */}
        <div
          className="absolute border-2 border-[#CC2200] top-[18%] left-[22%] w-[56%] h-[42%] flex items-start justify-center"
        >
          <div className="absolute -top-1 -left-1 w-3 h-3 border-t-[3px] border-l-[3px] border-[#CC2200]" />
          <div className="absolute -top-1 -right-1 w-3 h-3 border-t-[3px] border-r-[3px] border-[#CC2200]" />
          <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-[3px] border-l-[3px] border-[#CC2200]" />
          <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-[3px] border-r-[3px] border-[#CC2200]" />
          <div className="mt-1 px-2 py-0.5 text-[10px] font-bold tracking-wider bg-[#CC2200] text-[#14110D]">
            FACE: CAPTURED
          </div>
        </div>
        {/* Iris capture */}
        <div className="absolute border border-[#CC2200] top-[33%] left-[38%] w-[12%] h-[7%] flex items-start justify-center">
          <div className="mt-0.5 px-1 text-[8px] font-bold tracking-wider bg-[#CC2200] text-[#14110D] whitespace-nowrap">IRIS: CAPTURED</div>
        </div>
      </div>

      {/* Right pane: void shield result frozen — flat NONE badges */}
      <div className="w-1/2 h-full relative">
        <div className="absolute border border-[#F0A500]/60 top-[18%] left-[22%] w-[56%] h-[42%] flex items-start justify-center">
          <div className="absolute -top-0.5 -left-0.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#F0A500]/60" />
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#F0A500]/60" />
          <div className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#F0A500]/60" />
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#F0A500]/60" />
          <div className="mt-1 px-2 py-0.5">
            <span className="text-[10px] font-bold tracking-wider text-[#F0A500] uppercase">FACE: NONE</span>
          </div>
        </div>
        {/* BIOMETRICS STRIPPED badge remnant */}
        <div className="absolute top-[62%] left-1/2 -translate-x-1/2 bg-[#14110D]/70 border border-[#F0A500]/40 px-4 py-1.5 flex items-center justify-center">
          <span className="text-[#F0A500] text-[9px] tracking-[0.25em] font-bold uppercase">BIOMETRICS STRIPPED</span>
        </div>
      </div>
    </motion.div>
  );
}

export function Scene3() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-end items-center pb-24 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Fading scan-box remnants — visible at start of this scene */}
      <FrozenScanRemnants />

      {/* Thesis caption */}
      <motion.div
        className="bg-[#14110D]/92 border border-[#F0A500]/40 px-8 py-4 backdrop-blur-sm relative z-10"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -50, opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
      >
        <h2 className="text-3xl tracking-tight text-[#F0A500] uppercase font-bold text-center">
          ONE FEED IDENTIFIES YOU.
          <br />
          ONE DOESN'T.
        </h2>
      </motion.div>
    </motion.div>
  );
}

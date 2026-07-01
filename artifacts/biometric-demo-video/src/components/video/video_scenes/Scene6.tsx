// SPDX-License-Identifier: AGPL-3.0-or-later
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

const BRACKET_STYLE: React.CSSProperties = {
  fontFeatureSettings: '"liga" 0',
  fontVariantLigatures: 'none',
  fontSize: '0.82em',
  lineHeight: 1,
  display: 'inline-block',
  verticalAlign: '0.06em',
  letterSpacing: '0.1em',
  margin: '0 0.04em',
};

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // LIVE starts moving to center
      setTimeout(() => setPhase(2), 1800),  // dot flicker begins
      setTimeout(() => setPhase(3), 2500),  // dot snuffs, "LIVE" fades
      setTimeout(() => setPhase(4), 3200),  // "leave less behind" — lands on the snuff beat, held long
      setTimeout(() => setPhase(5), 5900),  // V[]ID wordmark (1s sooner; holds longer, endCard duration unchanged)
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 pointer-events-none bg-[#14110D] z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      {/* Background ember particles */}
      <motion.div
        className="absolute inset-0 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        transition={{ duration: 2 }}
      >
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-[#F0A500]"
            initial={{
              x: `${Math.random() * 1280}px`,
              y: '720px',
              opacity: Math.random() * 0.5 + 0.3,
            }}
            animate={{
              y: '-72px',
              x: `${Math.random() * 1280 + (Math.random() * 100 - 50)}px`,
              opacity: [0, Math.random() * 0.5 + 0.3, 0],
            }}
            transition={{
              duration: Math.random() * 3 + 2,
              repeat: Infinity,
              ease: 'linear',
              delay: Math.random() * 5,
            }}
          />
        ))}
      </motion.div>

      {/* LIVE indicator — starts at top-right, animates to center, flickers, snuffs */}
      <motion.div
        className="absolute flex items-center gap-1.5 pointer-events-none"
        initial={{ top: '3.5%', left: '88%', x: 0, y: 0, scale: 1, opacity: 1 }}
        animate={
          phase === 0
            ? { top: '3.5%', left: '88%', x: 0, y: 0, scale: 1, opacity: 1 }
            : phase >= 3
            ? { top: '50%', left: '50%', x: '-50%', y: '-50%', scale: 2.5, opacity: 0 }
            : { top: '50%', left: '50%', x: '-50%', y: '-50%', scale: 2.5, opacity: 1 }
        }
        transition={
          phase === 1
            ? { duration: 1.5, ease: 'easeInOut' }
            : phase === 3
            ? { duration: 0.8, ease: 'easeOut' }
            : { duration: 0.3 }
        }
      >
        <motion.div
          className="w-2 h-2 rounded-full bg-[#F0A500]"
          animate={
            phase === 2
              ? {
                  opacity: [1, 0, 1, 0.1, 1, 0, 0.9, 0, 0.8, 0.1, 0.6, 0, 0.4, 0.05, 0],
                  scale:   [1, 1.3, 1, 1.2, 1.1, 0.9, 1, 1.2, 0.8, 1.1, 0.9, 1, 0.7, 0.5, 0],
                }
              : phase >= 3
              ? { opacity: 0, scale: 0 }
              : phase === 1
              ? { opacity: 1, scale: [1, 1.5, 1.2] }
              : { opacity: [1, 0.3, 1] }
          }
          transition={
            phase === 2
              ? { duration: 0.7, ease: 'linear' }
              : phase >= 3
              ? { duration: 0.4, ease: 'easeOut' }
              : phase === 1
              ? { duration: 1.5, ease: 'easeOut' }
              : { duration: 2.4, repeat: Infinity }
          }
          style={{
            boxShadow:
              phase === 1 || phase === 2
                ? '0 0 10px 5px rgba(240,165,0,0.7)'
                : undefined,
          }}
        />
        <motion.span
          className="text-xs text-[#F0A500] tracking-widest font-bold"
          style={{
            filter: phase === 1 || phase === 2 ? 'brightness(2)' : undefined,
          }}
          animate={phase >= 3 ? { opacity: 0 } : { opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          LIVE
        </motion.span>
      </motion.div>

      {/* Center text sequence — phases 4, 5 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 4 && (
            <motion.p
              key="phase4"
              className="text-xl tracking-[0.3em] text-[#C4850A] relative z-10"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              leave less behind
            </motion.p>
          )}
          {phase >= 5 && (
            <motion.h1
              key="phase6"
              className="text-8xl font-black text-[#F0A500] tracking-[0.2em] relative z-10"
              initial={{ scale: 0.9, opacity: 0, filter: 'blur(10px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
            >
              V<span style={BRACKET_STYLE}>[]</span>ID
            </motion.h1>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

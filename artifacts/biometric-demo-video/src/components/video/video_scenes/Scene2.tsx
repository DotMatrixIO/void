// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),   // Face box appears (left)
      setTimeout(() => setPhase(2), 1100),  // Iris box appears (left)
      setTimeout(() => setPhase(3), 1800),  // Lip-read box (left)
      setTimeout(() => setPhase(4), 2500),  // Room context box (left)
      setTimeout(() => setPhase(5), 5200),  // Scan ends — unfreeze
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* ── LEFT PANE: biometric capture ── */}
      <div className="w-1/2 h-full relative">
        <motion.div
          className="absolute inset-0"
          style={{ boxShadow: 'inset 0 0 80px rgba(204,34,0,0.25)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase < 5 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        />

        <AnimatePresence>
          {phase >= 1 && phase < 5 && (
            <ScanBox
              key="face"
              label="FACE: CAPTURED"
              className="top-[18%] left-[22%] w-[56%] h-[42%]"
              color="#CC2200"
            />
          )}
          {phase >= 2 && phase < 5 && (
            <ScanBox
              key="iris"
              label="IRIS: CAPTURED"
              className="top-[33%] left-[38%] w-[12%] h-[7%]"
              color="#CC2200"
            />
          )}
          {phase >= 3 && phase < 5 && (
            <ScanBox
              key="lip"
              label="LIP-READ: CAPTURED"
              className="top-[52%] left-[37%] w-[26%] h-[8%]"
              color="#CC2200"
            />
          )}
          {phase >= 4 && phase < 5 && (
            <ScanBox
              key="room"
              label="ROOM CONTEXT: INDEXED"
              className="top-[16%] left-[6%] w-[88%] h-[76%]"
              color="#CC2200"
              dim
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── RIGHT PANE: VOID — nothing to capture ── */}
      <div className="w-1/2 h-full relative">
        <motion.div
          className="absolute inset-0"
          style={{ boxShadow: 'inset 0 0 80px rgba(240,165,0,0.10)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase < 5 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        />

        {/* Flat amber scan-result badges — mirror left-pane structure */}
        <AnimatePresence>
          {phase >= 1 && phase < 5 && (
            <FlatNoneBadge
              key="face-none"
              label="FACE: NONE"
              className="top-[18%] left-[22%] w-[56%] h-[42%]"
              delay={0.3}
            />
          )}
          {phase >= 2 && phase < 5 && (
            <FlatNoneBadge
              key="iris-none"
              label="IRIS: NONE"
              className="top-[33%] left-[38%] w-[12%] h-[7%]"
              delay={0.3}
            />
          )}
          {phase >= 3 && phase < 5 && (
            <FlatNoneBadge
              key="lip-none"
              label="LIP-READ: NONE"
              className="top-[52%] left-[37%] w-[26%] h-[8%]"
              delay={0.3}
            />
          )}
          {phase >= 4 && phase < 5 && (
            <FlatNoneBadge
              key="room-none"
              label="ROOM CONTEXT: NONE"
              className="top-[16%] left-[6%] w-[88%] h-[76%]"
              delay={0.3}
              dim
            />
          )}
        </AnimatePresence>

        {/* Center overlay — only after all four scan boxes are present */}
        {phase >= 4 && phase < 5 && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center z-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            <motion.div
              className="bg-[#14110D]/85 border border-[#F0A500]/60 px-6 py-3 flex items-center justify-center"
              animate={{ borderColor: ['rgba(240,165,0,0.6)', 'rgba(240,165,0,0.2)', 'rgba(240,165,0,0.6)'] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <span className="text-[#F0A500] text-xs tracking-[0.25em] font-bold uppercase">BIOMETRICS STRIPPED</span>
            </motion.div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function ScanBox({
  label,
  className,
  color,
  dim = false,
}: {
  label: string;
  className: string;
  color: string;
  dim?: boolean;
}) {
  return (
    <motion.div
      className={`absolute border-2 flex items-start justify-center ${className}`}
      style={{ borderColor: color, opacity: dim ? 0.5 : 1 }}
      initial={{ scale: 1.3, opacity: 0 }}
      animate={{ scale: 1, opacity: dim ? 0.5 : 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
    >
      <div className="absolute -top-1 -left-1 w-3 h-3 border-t-[3px] border-l-[3px]" style={{ borderColor: color }} />
      <div className="absolute -top-1 -right-1 w-3 h-3 border-t-[3px] border-r-[3px]" style={{ borderColor: color }} />
      <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-[3px] border-l-[3px]" style={{ borderColor: color }} />
      <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-[3px] border-r-[3px]" style={{ borderColor: color }} />

      <motion.div
        className="mt-1 px-2 py-0.5 text-[10px] font-bold tracking-wider"
        style={{ backgroundColor: color, color: '#14110D' }}
        animate={{ opacity: [1, 0.55, 1] }}
        transition={{ duration: 0.45, repeat: Infinity }}
      >
        {label}
      </motion.div>

      {/* Sweeping scan line */}
      <motion.div
        className="absolute left-0 right-0 h-px"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        animate={{ top: ['0%', '100%', '0%'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      />
    </motion.div>
  );
}

function FlatNoneBadge({
  label,
  className,
  delay,
  dim = false,
}: {
  label: string;
  className: string;
  delay: number;
  dim?: boolean;
}) {
  return (
    <motion.div
      className={`absolute border flex items-start justify-center ${className}`}
      style={{ borderColor: 'rgba(240,165,0,0.5)', opacity: dim ? 0.6 : 1 }}
      initial={{ scale: 1.2, opacity: 0 }}
      animate={{ scale: 1, opacity: dim ? 0.6 : 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      transition={{ delay, type: 'spring', stiffness: 200, damping: 25 }}
    >
      <div className="absolute -top-0.5 -left-0.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#F0A500]/60" />
      <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#F0A500]/60" />
      <div className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#F0A500]/60" />
      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#F0A500]/60" />

      <div className="mt-1 px-2 py-0.5 flex items-center justify-center">
        <span className="text-[10px] font-bold tracking-wider text-[#F0A500] uppercase">{label}</span>
      </div>
    </motion.div>
  );
}

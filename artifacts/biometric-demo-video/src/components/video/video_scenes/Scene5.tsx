// SPDX-License-Identifier: AGPL-3.0-or-later
import { motion } from 'framer-motion';

export function Scene5() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col justify-end items-center pb-24 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="bg-[#14110D]/90 border border-[#F0A500]/30 px-8 py-4 backdrop-blur-sm"
        initial={{ y: 50, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -50, opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
      >
        <h2 className="text-3xl tracking-tight text-[#F0A500] uppercase font-bold text-center">
          ENOUGH TO TRUST.
          <br />
          NOT ENOUGH TO SURVEIL.
        </h2>
      </motion.div>
    </motion.div>
  );
}

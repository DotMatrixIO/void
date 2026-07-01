// SPDX-License-Identifier: AGPL-3.0-or-later
import { motion } from 'framer-motion';

export function Scene1() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Subtle particle drift for intro overlay if needed, mostly handled by background */}
    </motion.div>
  );
}

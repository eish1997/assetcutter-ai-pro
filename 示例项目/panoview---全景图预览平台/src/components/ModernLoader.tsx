import React from 'react';
import { motion } from 'motion/react';

export const ModernLoader = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/60 backdrop-blur-2xl"
    >
      <div className="relative w-32 h-32 flex items-center justify-center">
        {/* Outer rotating ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 border-t-2 border-r-2 border-indigo-500/30 rounded-full"
        />
        
        {/* Inner pulsing ring */}
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-4 border-2 border-indigo-400/20 rounded-full"
        />

        {/* Center scanning element */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <motion.circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="url(#loaderGradient)"
              strokeWidth="2"
              strokeDasharray="280"
              initial={{ strokeDashoffset: 280 }}
              animate={{ strokeDashoffset: [280, 0, -280] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <defs>
              <linearGradient id="loaderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
          
          {/* Scanning line */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 flex justify-center"
          >
            <div className="w-0.5 h-1/2 bg-gradient-to-t from-indigo-500 to-transparent origin-bottom" />
          </motion.div>
        </div>
      </div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-8 flex flex-col items-center gap-2"
      >
        <span className="text-white font-display font-bold text-sm uppercase tracking-[0.3em]">
          Processing Panorama
        </span>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              className="w-1 h-1 bg-indigo-400 rounded-full"
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

'use client';

import { motion } from 'framer-motion';
import { Sparkles, Lock, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface UnlockAnimationProps {
  onComplete?: () => void;
  title: string;
}

export function UnlockAnimation({ onComplete, title }: UnlockAnimationProps) {
  const [phase, setPhase] = useState<'locked' | 'unlocking' | 'unlocked'>('locked');
  
  useEffect(() => {
    // Phase 1: Locked (0-1s)
    const timer1 = setTimeout(() => setPhase('unlocking'), 1000);
    
    // Phase 2: Unlocking (1-2s)
    const timer2 = setTimeout(() => setPhase('unlocked'), 2000);
    
    // Phase 3: Unlocked (2-3s)
    const timer3 = setTimeout(() => {
      onComplete?.();
    }, 3000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="relative flex flex-col items-center gap-8">
        {/* Sparkle particles */}
        {phase === 'unlocked' && (
          <>
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0],
                  x: Math.cos((i / 20) * Math.PI * 2) * 200,
                  y: Math.sin((i / 20) * Math.PI * 2) * 200,
                }}
                transition={{
                  duration: 1.5,
                  delay: i * 0.05,
                  ease: 'easeOut',
                }}
                className="absolute"
              >
                <Sparkles className="h-6 w-6 text-yellow-400" />
              </motion.div>
            ))}
          </>
        )}
        
        {/* Main icon */}
        <motion.div
          initial={{ scale: 1 }}
          animate={{
            scale: phase === 'unlocking' ? [1, 1.2, 1] : 1,
            rotate: phase === 'unlocking' ? [0, -10, 10, 0] : 0,
          }}
          transition={{
            duration: 0.6,
            ease: 'easeInOut',
          }}
          className={`relative flex h-32 w-32 items-center justify-center rounded-full ${
            phase === 'unlocked'
              ? 'bg-gradient-to-br from-green-500 to-emerald-600'
              : 'bg-gradient-to-br from-primary to-primary/70'
          }`}
        >
          <motion.div
            animate={{
              scale: phase === 'unlocking' ? [1, 1.1, 1] : 1,
            }}
            transition={{
              duration: 0.4,
              repeat: phase === 'unlocking' ? Infinity : 0,
            }}
          >
            {phase === 'unlocked' ? (
              <Unlock className="h-16 w-16 text-white" />
            ) : (
              <Lock className="h-16 w-16 text-white" />
            )}
          </motion.div>
          
          {/* Glow effect */}
          {phase === 'unlocked' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.5, 1, 0.5], scale: [0.8, 1.2, 0.8] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="absolute inset-0 rounded-full bg-green-500/30 blur-xl"
            />
          )}
        </motion.div>
        
        {/* Text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-center"
        >
          <h2 className="mb-2 text-3xl font-bold text-white">
            {phase === 'unlocked' ? 'Capsule Unlocked!' : 'Opening...'}
          </h2>
          <p className="text-lg text-white/80">{title}</p>
        </motion.div>
        
        {/* Progress bar */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: '100%' }}
          transition={{ duration: 3, ease: 'linear' }}
          className="h-1 max-w-xs rounded-full bg-white/30"
        >
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 3, ease: 'linear' }}
            className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-green-500"
          />
        </motion.div>
      </div>
    </motion.div>
  );
}

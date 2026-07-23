'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Star, Sparkles, Trophy } from 'lucide-react';

interface LevelUpAnimationProps {
  newLevel: number;
  onComplete?: () => void;
}

export function LevelUpAnimation({ newLevel, onComplete }: LevelUpAnimationProps) {
  const [phase, setPhase] = useState<'intro' | 'level' | 'celebration'>('intro');
  
  useEffect(() => {
    const timer1 = setTimeout(() => setPhase('level'), 500);
    const timer2 = setTimeout(() => setPhase('celebration'), 1500);
    const timer3 = setTimeout(() => onComplete?.(), 3000);
    
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
        {phase === 'celebration' && (
          <>
            {[...Array(30)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1.5, 0],
                  x: Math.cos((i / 30) * Math.PI * 2) * 300,
                  y: Math.sin((i / 30) * Math.PI * 2) * 300,
                }}
                transition={{
                  duration: 1.5,
                  delay: i * 0.03,
                  ease: 'easeOut',
                }}
                className="absolute"
              >
                {i % 3 === 0 ? (
                  <Star className="h-6 w-6 text-yellow-400 fill-yellow-400" />
                ) : i % 3 === 1 ? (
                  <Sparkles className="h-6 w-6 text-yellow-400" />
                ) : (
                  <Trophy className="h-6 w-6 text-yellow-400" />
                )}
              </motion.div>
            ))}
          </>
        )}
        
        {/* Main level display */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{
            scale: phase === 'intro' ? 0 : 1,
            rotate: phase === 'intro' ? -180 : 0,
          }}
          transition={{
            duration: 0.6,
            type: 'spring',
            stiffness: 200,
          }}
          className="relative flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500"
          style={{
            boxShadow: '0 0 60px rgba(251, 191, 36, 0.5)',
          }}
        >
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="text-center"
          >
            <div className="text-6xl font-black text-white">
              {newLevel}
            </div>
            <div className="text-sm font-semibold text-white/90">
              LEVEL UP!
            </div>
          </motion.div>
          
          {/* Glow effect */}
          <motion.div
            animate={{
              opacity: [0.3, 0.6, 0.3],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute inset-0 rounded-full bg-yellow-400/30 blur-xl"
          />
        </motion.div>
        
        {/* Text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: phase === 'intro' ? 0 : 1,
            y: phase === 'intro' ? 20 : 0,
          }}
          transition={{ delay: 0.5 }}
          className="text-center"
        >
          <h2 className="mb-2 text-4xl font-black text-white">
            Level {newLevel}!
          </h2>
          <p className="text-lg text-white/80">
            You&apos;re leveling up! 🎉
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}

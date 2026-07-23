'use client';

import { motion } from 'framer-motion';

interface Milestone {
  percentage: number;
  label: string;
  icon: string;
  isReached: boolean;
  reachedAt?: string;
}

interface MilestoneBadgeProps {
  milestone: Milestone;
  currentPercentage: number;
}

export function MilestoneBadge({ milestone, currentPercentage }: MilestoneBadgeProps) {
  const isReached = milestone.isReached || currentPercentage >= milestone.percentage;
  const progress = isReached ? 100 : Math.min(100, (currentPercentage / milestone.percentage) * 100);
  
  return (
    <motion.div 
      className="flex flex-col items-center gap-2"
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        animate={isReached ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.5 }}
        className={`relative flex h-14 w-14 items-center justify-center rounded-full text-2xl transition-all duration-200 ${
          isReached
            ? 'bg-green-500/20 ring-2 ring-green-500 shadow-lg shadow-green-500/20'
            : 'bg-[var(--color-surface-3)]/50 backdrop-blur-xl ring-1 ring-white/10'
        }`}
      >
        {isReached ? milestone.icon : '🔒'}
        
        {isReached && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white text-xs shadow-lg"
          >
            ✓
          </motion.div>
        )}
      </motion.div>
      
      <div className="text-center">
        <div className={`text-xs font-medium transition-colors ${isReached ? 'text-text-primary' : 'text-text-secondary'}`}>
          {milestone.label}
        </div>
        <div className="text-[10px] text-text-secondary">{milestone.percentage}%</div>
      </div>
      
      {/* Mini progress bar */}
      {!isReached && (
        <div className="w-12 h-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]/50">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)] to-[var(--color-accent-violet)]"
          />
        </div>
      )}
    </motion.div>
  );
}

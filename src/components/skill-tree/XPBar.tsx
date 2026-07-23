'use client';

import { motion } from 'framer-motion';

interface XPBarProps {
  current: number;
  needed: number;
  percentage: number;
  showNumbers?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function XPBar({
  current,
  needed,
  percentage,
  showNumbers = true,
  size = 'md',
}: XPBarProps) {
  const heightMap = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };
  
  return (
    <div className="w-full">
      {showNumbers && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-text-primary">
            {current} / {needed} XP
          </span>
          <motion.span 
            className="text-text-secondary font-medium"
            key={Math.round(percentage)}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            {Math.round(percentage)}%
          </motion.span>
        </div>
      )}
      
      <div className={`${heightMap[size]} overflow-hidden rounded-full bg-[var(--color-surface-3)]/50 backdrop-blur-xl ring-1 ring-white/10`}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)] via-[var(--color-accent-violet)] to-[var(--color-accent-selected)]"
          style={{
            boxShadow: '0 0 20px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        />
      </div>
    </div>
  );
}

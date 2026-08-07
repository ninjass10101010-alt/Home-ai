'use client';

import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import type { MoneyMountain } from '@/db/features/money-mountain';
import { formatCurrency, MOUNTAIN_THEMES } from '@/db/features/money-mountain';

interface MountainCardProps {
  mountain: MoneyMountain;
  onClick?: () => void;
}

export function MountainCard({ mountain, onClick }: MountainCardProps) {
  const theme = MOUNTAIN_THEMES[mountain.mountainTheme || 'snow'];
  const progress = mountain.percentageComplete;
  const isComplete = mountain.isCompleted || progress >= 100;
  
  const currentFormatted = formatCurrency(mountain.currentAmount, mountain.currency as any);
  const targetFormatted = formatCurrency(mountain.targetAmount, mountain.currency as any);
  
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border-2 cursor-pointer transition-all duration-200 ${
        isComplete
          ? 'border-green-500/50 bg-gradient-to-br from-green-500/10 to-emerald-500/10'
          : 'border-white/10 bg-[var(--color-surface-2)]/50 backdrop-blur-xl hover:border-white/20'
      }`}
    >
      {/* Hover glow effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
      </div>
      
      {/* Header with icon and progress */}
      <div
        className="relative p-4"
        style={{
          background: `linear-gradient(135deg, ${theme.accent}15, ${theme.accent}05)`,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
              style={{ backgroundColor: `${theme.accent}20` }}
            >
              {mountain.icon}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{mountain.name}</h3>
              {mountain.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{mountain.description}</p>
              )}
            </div>
          </div>
          
          {isComplete && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white">
              <Trophy className="h-4 w-4" />
            </div>
          )}
        </div>
        
        {/* Progress bar */}
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {currentFormatted} / {targetFormatted}
            </span>
            <span className="text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
              className="h-full rounded-full"
              style={{
                backgroundColor: isComplete ? '#22c55e' : theme.accent,
              }}
            />
          </div>
        </div>
        
        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{mountain.transactionCount} transactions</span>
          {mountain.matchEnabled && mountain.matchedAmount > 0 && (
            <span className="text-green-500 font-medium">
              +{formatCurrency(mountain.matchedAmount, mountain.currency as any)} matched
            </span>
          )}
          {mountain.deadline && (
            <span>
              Due {new Date(mountain.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

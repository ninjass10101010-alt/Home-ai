'use client';

import { motion } from 'framer-motion';
import type { Achievement, UserAchievement } from '@/db/features/skill-tree';

interface AchievementBadgeProps {
  achievement: Achievement;
  earned?: boolean;
  earnedAt?: string;
  onClick?: () => void;
}

const rarityColors = {
  common: 'from-[#94a3b8] to-[#64748b]',
  uncommon: 'from-[var(--color-accent-mint)] to-[var(--color-accent-mint)]',
  rare: 'from-[var(--color-accent-nori)] to-[var(--color-accent-nori)]',
  epic: 'from-[var(--color-accent-violet)] to-[var(--color-accent-violet)]',
  legendary: 'from-[var(--color-accent-amber)] to-[var(--color-accent-amber)]',
};

const rarityBorders = {
  common: 'border-[#94a3b8]',
  uncommon: 'border-[var(--color-accent-mint)]',
  rare: 'border-[var(--color-accent-nori)]',
  epic: 'border-[var(--color-accent-violet)]',
  legendary: 'border-[var(--color-accent-amber)]',
};

export function AchievementBadge({
  achievement,
  earned = false,
  earnedAt,
  onClick,
}: AchievementBadgeProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.05, y: -4 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border-2 p-4 cursor-pointer transition-all duration-200 ${
        earned
          ? `${rarityBorders[achievement.rarity]} bg-[var(--color-surface-2)]/50 backdrop-blur-xl hover:shadow-lg`
          : 'border-white/10 bg-[var(--color-surface-3)]/30 opacity-60 hover:opacity-80'
      }`}
    >
      {/* Hover glow */}
      {earned && (
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${rarityColors[achievement.rarity]} opacity-10`} />
        </div>
      )}
      
      {/* Icon */}
      <motion.div
        whileHover={{ rotate: [0, -10, 10, 0] }}
        transition={{ duration: 0.5 }}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${rarityColors[achievement.rarity]} shadow-lg`}
      >
        <span className="text-3xl">{achievement.icon}</span>
      </motion.div>
      
      {/* Name */}
      <h4 className="text-sm font-semibold text-center text-text-primary transition-colors">
        {achievement.name}
      </h4>
      
      {/* Description */}
      <p className="text-xs text-center text-text-secondary line-clamp-2">
        {achievement.description}
      </p>
      
      {/* Rarity Badge */}
      <motion.div
        whileHover={{ scale: 1.05 }}
        className={`rounded-full bg-gradient-to-r px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow-md ${rarityColors[achievement.rarity]}`}
      >
        {achievement.rarity}
      </motion.div>
      
      {/* Earned indicator */}
      {earned && (
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-mint)] text-white shadow-lg"
        >
          ✓
        </motion.div>
      )}
      
      {/* Earned date */}
      {earned && earnedAt && (
        <div className="text-[10px] text-text-secondary">
          {new Date(earnedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </div>
      )}
    </motion.div>
  );
}

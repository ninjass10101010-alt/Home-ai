'use client';

import { motion } from 'framer-motion';
import { AchievementBadge } from './AchievementBadge';
import type { Achievement, UserAchievement } from '@/db/features/skill-tree';

interface AchievementGalleryProps {
  achievements: Achievement[];
  userAchievements: UserAchievement[];
  onAchievementClick?: (achievementId: string) => void;
}

export function AchievementGallery({
  achievements,
  userAchievements,
  onAchievementClick,
}: AchievementGalleryProps) {
  const earnedIds = userAchievements.map((ua) => ua.achievementId);
  const earnedCount = earnedIds.length;
  const totalCount = achievements.length;
  const progress = totalCount > 0 ? (earnedCount / totalCount) * 100 : 0;
  
  // Group by rarity
  const byRarity = {
    legendary: achievements.filter((a) => a.rarity === 'legendary'),
    epic: achievements.filter((a) => a.rarity === 'epic'),
    rare: achievements.filter((a) => a.rarity === 'rare'),
    uncommon: achievements.filter((a) => a.rarity === 'uncommon'),
    common: achievements.filter((a) => a.rarity === 'common'),
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-gradient-to-br from-yellow-500/10 to-orange-500/10 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              🏆 Achievements
            </h2>
            <p className="text-sm text-muted-foreground">
              {earnedCount} of {totalCount} earned
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-foreground">
              {Math.round(progress)}%
            </div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8 }}
            className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-orange-500"
          />
        </div>
      </motion.div>
      
      {/* Achievements by Rarity */}
      {(['legendary', 'epic', 'rare', 'uncommon', 'common'] as const).map((rarity) => {
        const rarityAchievements = byRarity[rarity];
        if (rarityAchievements.length === 0) return null;
        
        const rarityLabels = {
          legendary: '🏆 Legendary',
          epic: '💎 Epic',
          rare: '⭐ Rare',
          uncommon: '✨ Uncommon',
          common: '⚪ Common',
        };
        
        return (
          <div key={rarity}>
            <h3 className="mb-3 text-lg font-semibold text-foreground">
              {rarityLabels[rarity]}
            </h3>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {rarityAchievements.map((achievement) => {
                const earned = earnedIds.includes(achievement.id);
                const userAchievement = userAchievements.find(
                  (ua) => ua.achievementId === achievement.id
                );
                
                return (
                  <AchievementBadge
                    key={achievement.id}
                    achievement={achievement}
                    earned={earned}
                    earnedAt={userAchievement?.earnedAt}
                    onClick={() => onAchievementClick?.(achievement.id)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

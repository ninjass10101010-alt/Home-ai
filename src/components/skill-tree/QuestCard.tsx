'use client';

import { motion } from 'framer-motion';
import { CheckCircle, Circle, PlayCircle, Star } from 'lucide-react';
import type { Quest } from '@/db/features/skill-tree';
import { XP_REWARDS } from '@/db/features/skill-tree';

interface QuestCardProps {
  quest: Quest;
  isCompleted: boolean;
  isActive: boolean;
  onClick?: () => void;
}

export function QuestCard({ quest, isCompleted, isActive, onClick }: QuestCardProps) {
  const xpReward = XP_REWARDS[quest.type]?.[quest.difficulty] || quest.xpReward;
  
  const difficultyColors = {
    easy: 'text-green-500',
    medium: 'text-yellow-500',
    hard: 'text-red-500',
  };
  
  const difficultyBgColors = {
    easy: 'bg-green-500/10',
    medium: 'bg-yellow-500/10',
    hard: 'bg-red-500/10',
  };
  
  return (
    <motion.div
      whileHover={{ scale: 1.02, x: 4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all duration-200 ${
        isCompleted
          ? 'border-green-500/30 bg-green-500/5'
          : isActive
          ? 'border-[var(--color-accent-selected)]/30 bg-[var(--color-accent-selected)]/5'
          : 'border-white/10 bg-[var(--color-surface-2)]/50 backdrop-blur-xl hover:border-white/20 hover:bg-[var(--color-surface-2)]/70'
      }`}
    >
      {/* Hover indicator */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <div className="w-1 h-8 bg-[var(--color-accent-selected)] rounded-l-full" />
      </div>
      
      {/* Status Icon */}
      <motion.div 
        className="flex-shrink-0"
        animate={isCompleted ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        {isCompleted ? (
          <CheckCircle className="h-6 w-6 text-green-500" />
        ) : isActive ? (
          <PlayCircle className="h-6 w-6 text-[var(--color-accent-selected)]" />
        ) : (
          <Circle className="h-6 w-6 text-text-secondary" />
        )}
      </motion.div>
      
      {/* Quest Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4
            className={`text-sm font-medium truncate transition-colors ${
              isCompleted ? 'text-text-secondary line-through' : 'text-text-primary'
            }`}
          >
            {quest.emoji} {quest.title}
          </h4>
        </div>
        
        <div className="flex items-center gap-2 text-xs">
          {/* Difficulty Badge */}
          <motion.span
            whileHover={{ scale: 1.05 }}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${difficultyBgColors[quest.difficulty]} ${difficultyColors[quest.difficulty]}`}
          >
            <Star className="h-3 w-3" />
            {quest.difficulty}
          </motion.span>
          
          {/* XP Reward */}
          <span className="text-text-secondary">
            +{xpReward} XP
          </span>
          
          {/* Requirement */}
          <span className="text-text-secondary">
            • {quest.requirementValue} {quest.requirementUnit}
          </span>
        </div>
      </div>
      
      {/* Action Hint */}
      {!isCompleted && (
        <motion.div 
          className="flex-shrink-0 text-xs text-text-secondary"
          initial={{ opacity: 0.5 }}
          whileHover={{ opacity: 1 }}
        >
          {isActive ? 'Continue' : 'Start'}
        </motion.div>
      )}
    </motion.div>
  );
}

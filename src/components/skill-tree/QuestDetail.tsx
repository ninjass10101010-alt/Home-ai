'use client';

import { motion } from 'framer-motion';
import { X, Star, Clock, CheckCircle, PlayCircle } from 'lucide-react';
import type { Quest } from '@/db/features/skill-tree';
import { XP_REWARDS } from '@/db/features/skill-tree';

interface QuestDetailProps {
  quest: Quest;
  isCompleted: boolean;
  isActive: boolean;
  onStart?: () => void;
  onComplete?: (proof: string) => void;
  onClose: () => void;
}

export function QuestDetail({
  quest,
  isCompleted,
  isActive,
  onStart,
  onComplete,
  onClose,
}: QuestDetailProps) {
  const xpReward = XP_REWARDS[quest.type]?.[quest.difficulty] || quest.xpReward;
  
  const difficultyColors = {
    easy: 'text-green-500 bg-green-500/10',
    medium: 'text-yellow-500 bg-yellow-500/10',
    hard: 'text-red-500 bg-red-500/10',
  };
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-4xl">{quest.emoji}</span>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-foreground">{quest.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${difficultyColors[quest.difficulty]}`}
                >
                  <Star className="h-3 w-3" />
                  {quest.difficulty}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {quest.type.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
          
          {/* Status */}
          {isCompleted && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-sm font-medium text-green-600">Completed!</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(quest.completedAt!).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          )}
          
          {isActive && !isCompleted && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 p-3">
              <PlayCircle className="h-5 w-5 text-primary" />
              <div className="text-sm font-medium text-primary">In Progress</div>
            </div>
          )}
        </div>
        
        {/* Description */}
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-foreground">Description</h3>
          <p className="text-sm text-muted-foreground">{quest.description}</p>
        </div>
        
        {/* Requirements */}
        <div className="mb-6 rounded-lg bg-muted/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Requirements</h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {quest.requirementValue} {quest.requirementUnit}
            </span>
          </div>
          {quest.requirementType === 'proof' && (
            <p className="mt-2 text-xs text-muted-foreground">
              You&apos;ll need to provide proof (photo, screenshot, etc.)
            </p>
          )}
        </div>
        
        {/* XP Reward */}
        <div className="mb-6 rounded-lg bg-primary/10 border border-primary/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">XP Reward</span>
            <span className="text-2xl font-bold text-primary">+{xpReward} XP</span>
          </div>
        </div>
        
        {/* Repeat Info */}
        {quest.repeatable && (
          <div className="mb-6 text-xs text-muted-foreground">
            <span>✓ This quest can be repeated</span>
            {quest.maxCompletions && (
              <span> (max {quest.maxCompletions} times)</span>
            )}
          </div>
        )}
        
        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Close
          </button>
          
          {!isCompleted && (
            <button
              onClick={() => {
                if (isActive) {
                  onComplete?.('');
                } else {
                  onStart?.();
                }
              }}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {isActive ? 'Complete Quest' : 'Start Quest'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

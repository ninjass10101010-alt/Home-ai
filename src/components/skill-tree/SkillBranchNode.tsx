'use client';

import { motion } from 'framer-motion';
import { Lock, Unlock } from 'lucide-react';
import { QuestCard } from './QuestCard';
import type { SkillBranch, Quest } from '@/db/features/skill-tree';

interface SkillBranchNodeProps {
  branch: SkillBranch;
  totalQuests: number;
  completedQuests: number;
  progress: number;
  isUnlocked: boolean;
  meetsRequirements: boolean;
  quests: Quest[];
  completedQuestIds: string[];
  activeQuestIds: string[];
  onQuestSelect?: (questId: string) => void;
  onBranchSelect?: (branchId: string) => void;
}

export function SkillBranchNode({
  branch,
  totalQuests,
  completedQuests,
  progress,
  isUnlocked,
  meetsRequirements,
  quests,
  completedQuestIds,
  activeQuestIds,
  onQuestSelect,
  onBranchSelect,
}: SkillBranchNodeProps) {
  const canUnlock = !isUnlocked && meetsRequirements;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative overflow-hidden rounded-2xl border-2 transition-all ${
        isUnlocked
          ? 'border-border bg-card'
          : canUnlock
          ? 'border-primary/50 bg-primary/5 cursor-pointer'
          : 'border-border/50 bg-muted/30'
      }`}
      onClick={canUnlock ? () => onBranchSelect?.(branch.id) : undefined}
    >
      {/* Branch Header */}
      <div
        className="p-4"
        style={{
          background: `linear-gradient(135deg, ${branch.color}20, ${branch.color}10)`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: `${branch.color}30` }}
            >
              <span className="text-2xl">{branch.icon}</span>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{branch.name}</h3>
              <p className="text-xs text-muted-foreground">
                {completedQuests}/{totalQuests} quests
              </p>
            </div>
          </div>
          
          {/* Lock/Unlock Icon */}
          {isUnlocked ? (
            <Unlock className="h-5 w-5 text-green-500" />
          ) : canUnlock ? (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Unlock className="h-5 w-5 text-primary" />
            </motion.div>
          ) : (
            <Lock className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        
        {/* Description */}
        {branch.description && (
          <p className="mb-3 text-sm text-muted-foreground">
            {branch.description}
          </p>
        )}
        
        {/* Progress Bar */}
        {isUnlocked && (
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium text-foreground">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
                className="h-full rounded-full"
                style={{ backgroundColor: branch.color }}
              />
            </div>
          </div>
        )}
        
        {/* Unlock Requirements */}
        {!isUnlocked && (
          <div className="rounded-lg bg-background/50 p-2 text-xs">
            <div className="font-medium text-foreground mb-1">
              Requirements to unlock:
            </div>
            <div className="space-y-0.5 text-muted-foreground">
              <div>
                • Level {branch.unlockLevel} {meetsRequirements ? '✓' : `(${branch.unlockLevel} needed)`}
              </div>
              {branch.unlockXP > 0 && (
                <div>
                  • {branch.unlockXP} XP
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Quests List */}
      {isUnlocked && quests.length > 0 && (
        <div className="space-y-2 p-4 pt-0">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Quests in this branch:
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {quests.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                isCompleted={completedQuestIds.includes(quest.id)}
                isActive={activeQuestIds.includes(quest.id)}
                onClick={() => onQuestSelect?.(quest.id)}
              />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

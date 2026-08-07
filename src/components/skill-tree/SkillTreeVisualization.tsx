'use client';

import { motion } from 'framer-motion';
import { SkillBranchNode } from './SkillBranchNode';
import { XPBar } from './XPBar';
import type { SkillTreeProfile, SkillBranch, Quest, UserAchievement } from '@/db/features/skill-tree';

interface BranchProgress {
  branch: SkillBranch;
  totalQuests: number;
  completedQuests: number;
  progress: number;
  isUnlocked: boolean;
  meetsRequirements: boolean;
}

interface SkillTreeVisualizationProps {
  profile: SkillTreeProfile;
  branches: BranchProgress[];
  quests: Quest[];
  userAchievements: UserAchievement[];
  xpProgress: {
    current: number;
    needed: number;
    percentage: number;
  };
  onQuestSelect?: (questId: string) => void;
  onBranchSelect?: (branchId: string) => void;
}

export function SkillTreeVisualization({
  profile,
  branches,
  quests,
  userAchievements,
  xpProgress,
  onQuestSelect,
  onBranchSelect,
}: SkillTreeVisualizationProps) {
  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 to-primary/5 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Level {profile.level}
            </h2>
            <p className="text-sm text-muted-foreground">
              {profile.totalXP} total XP
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-foreground">
              🔥 {profile.currentStreak} day streak
            </div>
            <div className="text-xs text-muted-foreground">
              Best: {profile.longestStreak} days
            </div>
          </div>
        </div>
        
        <XPBar
          current={xpProgress.current}
          needed={xpProgress.needed}
          percentage={xpProgress.percentage}
        />
      </motion.div>
      
      {/* Skill Branches Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {branches.map((branchProgress, index) => (
          <SkillBranchNode
            key={branchProgress.branch.id}
            branch={branchProgress.branch}
            totalQuests={branchProgress.totalQuests}
            completedQuests={branchProgress.completedQuests}
            progress={branchProgress.progress}
            isUnlocked={branchProgress.isUnlocked}
            meetsRequirements={branchProgress.meetsRequirements}
            quests={quests.filter((q) => q.branchId === branchProgress.branch.id)}
            completedQuestIds={profile.completedQuests || []}
            activeQuestIds={profile.activeQuests || []}
            onQuestSelect={onQuestSelect}
            onBranchSelect={onBranchSelect}
          />
        ))}
      </div>
      
      {/* Achievements Preview */}
      {userAchievements.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            Recent Achievements 🏆
          </h3>
          <div className="flex flex-wrap gap-3">
            {userAchievements.slice(0, 8).map((ua) => (
              <div
                key={ua.id}
                className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm"
                title={`Achievement ${ua.achievementId}`}
              >
                <span className="text-lg">🏆</span>
                <span className="font-medium text-foreground">
                  {ua.achievementId}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

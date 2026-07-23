'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { BookOpen, Trophy } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import EmergencyButton from '@/components/ui/EmergencyButton';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { SkillTreeVisualization } from '@/components/skill-tree/SkillTreeVisualization';
import { AchievementGallery } from '@/components/skill-tree/AchievementGallery';
import { QuestDetail } from '@/components/skill-tree/QuestDetail';
import { LevelUpAnimation } from '@/components/skill-tree/LevelUpAnimation';
import type {
  SkillTreeProfile,
  SkillBranch,
  Quest,
  Achievement,
  UserAchievement,
} from '@/db/features/skill-tree';
import { calculateLevelFromXP, calculateXPProgress } from '@/db/features/skill-tree';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

interface BranchProgress {
  branch: SkillBranch;
  totalQuests: number;
  completedQuests: number;
  progress: number;
  isUnlocked: boolean;
  meetsRequirements: boolean;
}

interface SkillTreeData {
  profile: SkillTreeProfile;
  branches: BranchProgress[];
  quests: Quest[];
  achievements: Achievement[];
  userAchievements: UserAchievement[];
  xpProgress: {
    current: number;
    needed: number;
    percentage: number;
  };
}

export default function SkillTreePage() {
  const [data, setData] = useState<SkillTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tree' | 'achievements'>('tree');
  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null);
  const [showLevelUp, setShowLevelUp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSkillTree();
  }, []);

  const loadSkillTree = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/skill-tree', {
        headers: {
          'x-user-id': 'demo-user',
        },
      });

      if (response.ok) {
        const skillTreeData = await response.json();
        setData(skillTreeData);
      } else {
        setError('Failed to load skill tree');
      }
    } catch (err) {
      setError('Failed to load skill tree');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuest = async (questId: string) => {
    try {
      const response = await fetch(`/api/skill-tree/quests/${questId}/start`, {
        method: 'POST',
        headers: {
          'x-user-id': 'demo-user',
        },
      });

      if (response.ok) {
        await loadSkillTree();
        setSelectedQuest(null);
      }
    } catch (err) {
      console.error('Failed to start quest:', err);
    }
  };

  const handleCompleteQuest = async (questId: string, proof: string = '') => {
    try {
      const response = await fetch(`/api/skill-tree/quests/${questId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'demo-user',
        },
        body: JSON.stringify({ proof }),
      });

      if (response.ok) {
        const result = await response.json();
        await loadSkillTree();
        setSelectedQuest(null);

        // Show level up animation if leveled up
        if (result.leveledUp) {
          setShowLevelUp(result.newLevel);
        }
      }
    } catch (err) {
      console.error('Failed to complete quest:', err);
    }
  };

  const handleUnlockBranch = async (branchId: string) => {
    try {
      const response = await fetch(`/api/skill-tree/branches/${branchId}/unlock`, {
        method: 'POST',
        headers: {
          'x-user-id': 'demo-user',
        },
      });

      if (response.ok) {
        await loadSkillTree();
      }
    } catch (err) {
      console.error('Failed to unlock branch:', err);
    }
  };

  if (loading) {
    return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: 'transparent' }}>
          <EmergencyButton />
          <div className="relative z-10 px-4 pt-10 pb-6">
            <Surface variant="warm" padding="lg" radius="2xl">
              <div className="flex items-center gap-4 mb-6">
                <Skeleton className="h-14 w-14 rounded-2xl" />
                <div>
                  <Skeleton className="h-8 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
              </div>
              <Skeleton className="h-96" />
            </Surface>
          </div>
        </PageShell>
      </AtmosphericProvider>
    );
  }

  if (error || !data) {
    return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: 'transparent' }}>
          <EmergencyButton />
          <div className="relative z-10 px-4 pt-10 pb-6">
            <EmptyState
              title="Unable to Load Skill Tree"
              description={error || 'Unknown error'}
              icon="🌳"
              actionLabel="Retry"
              onAction={loadSkillTree}
            />
          </div>
        </PageShell>
      </AtmosphericProvider>
    );
  }

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10 px-4 pt-10 pb-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <Surface variant="warm" radius="xl" padding="md" className="flex h-14 w-14 items-center justify-center floating">
                  <BookOpen className="h-7 w-7 text-[var(--color-accent-violet)]" />
                </Surface>
                <div>
                  <h1 className="text-3xl font-bold text-text-primary">Skill Tree</h1>
                  <p className="text-text-secondary">Learn, grow, and achieve!</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
              <Button
                variant={activeTab === 'tree' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('tree')}
              >
                <BookOpen className="h-4 w-4" />
                Skill Tree
              </Button>
              <Button
                variant={activeTab === 'achievements' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('achievements')}
              >
                <Trophy className="h-4 w-4" />
                Achievements ({data.userAchievements.length})
              </Button>
            </div>
          </motion.div>

          {/* Content */}
          {activeTab === 'tree' ? (
            <SkillTreeVisualization
              profile={data.profile}
              branches={data.branches}
              quests={data.quests}
              userAchievements={data.userAchievements}
              xpProgress={data.xpProgress}
              onQuestSelect={(questId) => {
                const quest = data.quests.find((q) => q.id === questId);
                if (quest) setSelectedQuest(quest);
              }}
              onBranchSelect={handleUnlockBranch}
            />
          ) : (
            <AchievementGallery
              achievements={data.achievements}
              userAchievements={data.userAchievements}
            />
          )}

          {/* Quest Detail Modal */}
          {selectedQuest && (
            <QuestDetail
              quest={selectedQuest}
              isCompleted={data.profile.completedQuests?.includes(selectedQuest.id) || false}
              isActive={data.profile.activeQuests?.includes(selectedQuest.id) || false}
              onStart={() => handleStartQuest(selectedQuest.id)}
              onComplete={(proof) => handleCompleteQuest(selectedQuest.id, proof)}
              onClose={() => setSelectedQuest(null)}
            />
          )}

          {/* Level Up Animation */}
          {showLevelUp && (
            <LevelUpAnimation
              newLevel={showLevelUp}
              onComplete={() => setShowLevelUp(null)}
            />
          )}
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}

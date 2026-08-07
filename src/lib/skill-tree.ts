import { getPB } from '@/lib/pb';
import type {
  SkillTreeProfile,
  SkillBranch,
  Quest,
  Achievement,
  UserAchievement,
} from '@/db/features/skill-tree';
import {
  calculateLevelFromXP,
  calculateXPForLevel,
  calculateXPProgress,
  XP_REWARDS,
} from '@/db/features/skill-tree';

/**
 * Get or create a skill tree profile for a user.
 */
export async function getSkillTreeProfile(userId: string): Promise<SkillTreeProfile | null> {
  const pb = getPB();
  
  try {
    const profiles = await pb.collection('skill_tree_profiles').getList<SkillTreeProfile>(1, 1, {
      filter: `userId = "${userId}"`,
    });
    
    if (profiles.items.length > 0) {
      return profiles.items[0];
    }
    
    // Create new profile with defaults
    const profile = await pb.collection('skill_tree_profiles').create<SkillTreeProfile>({
      userId,
      totalXP: 0,
      level: 1,
      xpToNextLevel: 100,
      unlockedBranches: [],
      completedQuests: [],
      activeQuests: [],
      achievementCount: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: new Date().toISOString(),
    });
    
    return profile;
  } catch (error) {
    console.error('Failed to get skill tree profile:', error);
    return null;
  }
}

/**
 * Get all skill branches.
 */
export async function getSkillBranches(): Promise<SkillBranch[]> {
  const pb = getPB();
  
  try {
    const branches = await pb.collection('skill_branches').getFullList<SkillBranch>({
      sort: 'order',
    });
    
    return branches;
  } catch (error) {
    console.error('Failed to get skill branches:', error);
    return [];
  }
}

/**
 * Get all quests for a specific branch.
 */
export async function getBranchQuests(branchId: string): Promise<Quest[]> {
  const pb = getPB();
  
  try {
    const quests = await pb.collection('quests').getFullList<Quest>({
      filter: `branchId = "${branchId}"`,
      sort: 'order',
    });
    
    return quests;
  } catch (error) {
    console.error('Failed to get branch quests:', error);
    return [];
  }
}

/**
 * Get all quests.
 */
export async function getAllQuests(): Promise<Quest[]> {
  const pb = getPB();
  
  try {
    const quests = await pb.collection('quests').getFullList<Quest>({
      sort: 'branchId, order',
    });
    
    return quests;
  } catch (error) {
    console.error('Failed to get all quests:', error);
    return [];
  }
}

/**
 * Complete a quest and award XP.
 */
export async function completeQuest(
  questId: string,
  userId: string,
  proof?: string
): Promise<{ success: boolean; xpEarned: number; newLevel?: number; leveledUp?: boolean }> {
  const pb = getPB();
  
  try {
    // Get quest
    const quest = await pb.collection('quests').getOne<Quest>(questId);
    
    // Check if quest is repeatable
    if (!quest.repeatable && quest.completedBy) {
      return { success: false, xpEarned: 0 };
    }
    
    // Check max completions
    if (quest.maxCompletions && quest.completionCount >= quest.maxCompletions) {
      return { success: false, xpEarned: 0 };
    }
    
    // Update quest
    const updateData: any = {
      status: 'completed',
      completedBy: userId,
      completedAt: new Date().toISOString(),
      proof: proof || '',
      completionCount: quest.completionCount + 1,
    };
    
    await pb.collection('quests').update(questId, updateData);
    
    // Calculate XP earned
    const xpEarned = XP_REWARDS[quest.type]?.[quest.difficulty] || quest.xpReward;
    
    // Update user profile
    const profile = await getSkillTreeProfile(userId);
    if (!profile) {
      return { success: false, xpEarned: 0 };
    }
    
    const newTotalXP = profile.totalXP + xpEarned;
    const newLevel = calculateLevelFromXP(newTotalXP);
    const xpProgress = calculateXPProgress(newTotalXP);
    const leveledUp = newLevel > profile.level;
    
    // Update profile
    const completedQuests = [...(profile.completedQuests || []), questId];
    const activeQuests = (profile.activeQuests || []).filter((id: string) => id !== questId);
    
    // Update streak
    const today = new Date().toDateString();
    const lastActivity = profile.lastActivityDate ? new Date(profile.lastActivityDate).toDateString() : null;
    let newStreak = profile.currentStreak;
    
    if (lastActivity !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (lastActivity === yesterday.toDateString()) {
        newStreak += 1;
      } else if (lastActivity !== today) {
        newStreak = 1;
      }
    }
    
    await pb.collection('skill_tree_profiles').update(profile.id, {
      totalXP: newTotalXP,
      level: newLevel,
      xpToNextLevel: xpProgress.needed,
      completedQuests,
      activeQuests,
      currentStreak: newStreak,
      longestStreak: Math.max(profile.longestStreak, newStreak),
      lastActivityDate: new Date().toISOString(),
    });
    
    // Check for new achievements
    await checkAndAwardAchievements(userId, newTotalXP, newLevel, newStreak, completedQuests.length);
    
    return {
      success: true,
      xpEarned,
      newLevel,
      leveledUp,
    };
  } catch (error) {
    console.error('Failed to complete quest:', error);
    return { success: false, xpEarned: 0 };
  }
}

/**
 * Start a quest (mark as active).
 */
export async function startQuest(questId: string, userId: string): Promise<boolean> {
  const pb = getPB();
  
  try {
    const quest = await pb.collection('quests').getOne<Quest>(questId);
    
    // Check if quest is already active
    if (quest.status === 'in_progress' || quest.status === 'completed') {
      return false;
    }
    
    // Update quest status
    await pb.collection('quests').update(questId, {
      status: 'in_progress',
    });
    
    // Add to user's active quests
    const profile = await getSkillTreeProfile(userId);
    if (!profile) return false;
    
    const activeQuests = [...(profile.activeQuests || []), questId];
    await pb.collection('skill_tree_profiles').update(profile.id, {
      activeQuests,
    });
    
    return true;
  } catch (error) {
    console.error('Failed to start quest:', error);
    return false;
  }
}

/**
 * Get all achievements.
 */
export async function getAchievements(): Promise<Achievement[]> {
  const pb = getPB();
  
  try {
    const achievements = await pb.collection('achievements').getFullList<Achievement>({
      sort: 'order',
    });
    
    return achievements;
  } catch (error) {
    console.error('Failed to get achievements:', error);
    return [];
  }
}

/**
 * Get user's earned achievements.
 */
export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  const pb = getPB();
  
  try {
    const userAchievements = await pb.collection('user_achievements').getFullList<UserAchievement>({
      filter: `userId = "${userId}"`,
      sort: '-earnedAt',
    });
    
    return userAchievements;
  } catch (error) {
    console.error('Failed to get user achievements:', error);
    return [];
  }
}

/**
 * Check and award achievements based on user progress.
 */
async function checkAndAwardAchievements(
  userId: string,
  totalXP: number,
  level: number,
  streak: number,
  questsCompleted: number
): Promise<void> {
  const pb = getPB();
  
  try {
    const achievements = await getAchievements();
    const userAchievements = await getUserAchievements(userId);
    const earnedIds = userAchievements.map((ua) => ua.achievementId);
    
    for (const achievement of achievements) {
      // Skip if already earned
      if (earnedIds.includes(achievement.id)) continue;
      
      let shouldAward = false;
      
      // Check criteria
      switch (achievement.criteriaType) {
        case 'xp_total':
          shouldAward = totalXP >= achievement.criteriaValue;
          break;
        case 'level':
          shouldAward = level >= achievement.criteriaValue;
          break;
        case 'streak':
          shouldAward = streak >= achievement.criteriaValue;
          break;
        case 'quests_completed':
          shouldAward = questsCompleted >= achievement.criteriaValue;
          break;
      }
      
      if (shouldAward) {
        // Award achievement
        await pb.collection('user_achievements').create({
          userId,
          achievementId: achievement.id,
          earnedAt: new Date().toISOString(),
          levelAtTime: level,
          xpAtTime: totalXP,
        });
        
        // Update profile achievement count
        const profile = await getSkillTreeProfile(userId);
        if (profile) {
          await pb.collection('skill_tree_profiles').update(profile.id, {
            achievementCount: (profile.achievementCount || 0) + 1,
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to check achievements:', error);
  }
}

/**
 * Unlock a skill branch.
 */
export async function unlockBranch(branchId: string, userId: string): Promise<boolean> {
  const pb = getPB();
  
  try {
    const branch = await pb.collection('skill_branches').getOne<SkillBranch>(branchId);
    const profile = await getSkillTreeProfile(userId);
    
    if (!profile) return false;
    
    // Check if user meets requirements
    if (profile.level < branch.unlockLevel || profile.totalXP < branch.unlockXP) {
      return false;
    }
    
    // Check prerequisites
    const unlockedBranches = profile.unlockedBranches || [];
    for (const prereqId of branch.prerequisiteBranches || []) {
      if (!unlockedBranches.includes(prereqId)) {
        return false;
      }
    }
    
    // Unlock branch
    if (!unlockedBranches.includes(branchId)) {
      unlockedBranches.push(branchId);
      await pb.collection('skill_tree_profiles').update(profile.id, {
        unlockedBranches,
      });
    }
    
    return true;
  } catch (error) {
    console.error('Failed to unlock branch:', error);
    return false;
  }
}

/**
 * Get skill tree visualization data.
 */
export async function getSkillTreeVisualization(userId: string) {
  const profile = await getSkillTreeProfile(userId);
  const branches = await getSkillBranches();
  const allQuests = await getAllQuests();
  const achievements = await getAchievements();
  const userAchievements = await getUserAchievements(userId);
  
  if (!profile) {
    return null;
  }
  
  // Organize quests by branch
  const questsByBranch: Record<string, Quest[]> = {};
  for (const quest of allQuests) {
    if (!questsByBranch[quest.branchId]) {
      questsByBranch[quest.branchId] = [];
    }
    questsByBranch[quest.branchId].push(quest);
  }
  
  // Calculate progress for each branch
  const branchProgress = branches.map((branch) => {
    const quests = questsByBranch[branch.id] || [];
    const completed = quests.filter((q) => 
      profile.completedQuests?.includes(q.id)
    ).length;
    
    return {
      branch,
      totalQuests: quests.length,
      completedQuests: completed,
      progress: quests.length > 0 ? (completed / quests.length) * 100 : 0,
      isUnlocked: (profile.unlockedBranches || []).includes(branch.id),
      meetsRequirements: profile.level >= branch.unlockLevel && profile.totalXP >= branch.unlockXP,
    };
  });
  
  return {
    profile,
    branches: branchProgress,
    quests: allQuests,
    achievements,
    userAchievements: userAchievements.map((ua) => {
      const achievement = achievements.find((a) => a.id === ua.achievementId);
      return { ...ua, achievement };
    }),
    xpProgress: calculateXPProgress(profile.totalXP),
  };
}

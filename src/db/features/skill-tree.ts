/**
 * Skill Tree Learning - Database Types
 * 
 * Gamified learning paths that visualize progress like RPG skill trees.
 * Kids earn XP, level up, and unlock achievements through real-world learning.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type BranchCategory = 'math' | 'reading' | 'science' | 'creative' | 'life_skill' | 'custom';

export type QuestType = 'read' | 'math' | 'science' | 'creative' | 'life_skill' | 'custom';

export type QuestDifficulty = 'easy' | 'medium' | 'hard';

export type QuestStatus = 'available' | 'in_progress' | 'completed' | 'approved';

export type AchievementCategory = 'streak' | 'milestone' | 'mastery' | 'challenge';

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface SkillTreeProfile {
  id: string;
  userId: string;
  totalXP: number;
  level: number;
  xpToNextLevel: number;
  unlockedBranches: string[]; // branch IDs
  completedQuests: string[]; // quest IDs
  activeQuests: string[]; // quest IDs in progress
  achievementCount: number;
  currentStreak: number; // consecutive days of learning
  longestStreak: number;
  lastActivityDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillBranch {
  id: string;
  name: string; // "Math Explorer", "Word Wizard"
  icon: string; // emoji
  category: BranchCategory;
  color: string; // hex color
  description: string;
  
  // Tree structure
  prerequisiteBranches: string[]; // branch IDs that must be unlocked first
  unlockLevel: number; // minimum level to unlock this branch
  unlockXP: number; // total XP needed
  
  // Progress
  questCount: number;
  completedCount: number;
  
  // Display
  order: number; // sort order in tree
  isDefault: boolean; // system-provided branch
  createdBy?: string; // for custom branches
  createdAt: string;
}

export interface Quest {
  id: string;
  branchId: string;
  title: string;
  description: string;
  type: QuestType;
  difficulty: QuestDifficulty;
  xpReward: number;
  
  // Requirements
  requirementType: 'time' | 'count' | 'approval' | 'proof';
  requirementValue: number;
  requirementUnit?: string; // 'minutes', 'books', 'pages', 'problems'
  
  // Status
  status: QuestStatus;
  assignedTo: string[]; // user IDs
  completedBy?: string; // user ID who completed
  completedAt?: string;
  approvedBy?: string; // parent who approved
  approvedAt?: string;
  
  // Proof
  proof?: string; // text description or file path
  proofType?: ContentType;
  
  // Metadata
  order: number; // position in branch
  repeatable: boolean;
  maxCompletions?: number;
  completionCount: number;
  
  // Display
  emoji?: string;
  isDefault: boolean; // system-provided quest
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  category: AchievementCategory;
  
  // Unlock criteria
  criteriaType: 'xp_total' | 'level' | 'quests_completed' | 'streak' | 'branch_complete' | 'custom';
  criteriaValue: number;
  criteriaDescription: string; // human-readable
  
  // Display
  color?: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  order: number;
  isDefault: boolean;
  createdAt: string;
}

export interface UserAchievement {
  id: string;
  userId: string;
  achievementId: string;
  earnedAt: string;
  
  // Snapshot at time of earning
  levelAtTime: number;
  xpAtTime: number;
}

// ─── Supporting Types ────────────────────────────────────────────────────────

type ContentType = 'text' | 'photo' | 'voice' | 'video';

// ─── PocketBase Collection Schemas ───────────────────────────────────────────

export const skillTreeProfilesSchema = {
  name: 'skill_tree_profiles',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'totalXP', type: 'number', required: true, defaultValue: 0 },
    { name: 'level', type: 'number', required: true, defaultValue: 1 },
    { name: 'xpToNextLevel', type: 'number', required: true, defaultValue: 100 },
    { name: 'unlockedBranches', type: 'relation', required: false, collectionId: 'skill_branches', maxSelect: null },
    { name: 'completedQuests', type: 'json', required: false }, // array of quest IDs (too many for relation)
    { name: 'activeQuests', type: 'json', required: false },
    { name: 'achievementCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'currentStreak', type: 'number', required: true, defaultValue: 0 },
    { name: 'longestStreak', type: 'number', required: true, defaultValue: 0 },
    { name: 'lastActivityDate', type: 'date', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_stp_user_id ON skill_tree_profiles (userId)',
    'CREATE INDEX idx_stp_level ON skill_tree_profiles (level)',
    'CREATE INDEX idx_stp_total_xp ON skill_tree_profiles (totalXP)',
  ],
};

export const skillBranchesSchema = {
  name: 'skill_branches',
  type: 'base',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'icon', type: 'text', required: true },
    { name: 'category', type: 'select', required: true, values: ['math', 'reading', 'science', 'creative', 'life_skill', 'custom'] },
    { name: 'color', type: 'text', required: true },
    { name: 'description', type: 'text', required: false },
    { name: 'prerequisiteBranches', type: 'json', required: false }, // array of branch IDs
    { name: 'unlockLevel', type: 'number', required: true, defaultValue: 1 },
    { name: 'unlockXP', type: 'number', required: true, defaultValue: 0 },
    { name: 'questCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'completedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'order', type: 'number', required: true, defaultValue: 0 },
    { name: 'isDefault', type: 'bool', required: true, defaultValue: false },
    { name: 'createdBy', type: 'relation', required: false, collectionId: 'users' },
  ],
  indexes: [
    'CREATE INDEX idx_skill_branches_category ON skill_branches (category)',
    'CREATE INDEX idx_skill_branches_order ON skill_branches (order)',
  ],
};

export const questsSchema = {
  name: 'quests',
  type: 'base',
  fields: [
    { name: 'branchId', type: 'relation', required: true, collectionId: 'skill_branches', cascadeDelete: true },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'text', required: true },
    { name: 'type', type: 'select', required: true, values: ['read', 'math', 'science', 'creative', 'life_skill', 'custom'] },
    { name: 'difficulty', type: 'select', required: true, values: ['easy', 'medium', 'hard'] },
    { name: 'xpReward', type: 'number', required: true },
    { name: 'requirementType', type: 'select', required: true, values: ['time', 'count', 'approval', 'proof'] },
    { name: 'requirementValue', type: 'number', required: true },
    { name: 'requirementUnit', type: 'text', required: false },
    { name: 'status', type: 'select', required: true, values: ['available', 'in_progress', 'completed', 'approved'], defaultValue: 'available' },
    { name: 'assignedTo', type: 'json', required: false }, // array of user IDs
    { name: 'completedBy', type: 'relation', required: false, collectionId: 'users' },
    { name: 'completedAt', type: 'date', required: false },
    { name: 'approvedBy', type: 'relation', required: false, collectionId: 'users' },
    { name: 'approvedAt', type: 'date', required: false },
    { name: 'proof', type: 'text', required: false },
    { name: 'order', type: 'number', required: true, defaultValue: 0 },
    { name: 'repeatable', type: 'bool', required: true, defaultValue: false },
    { name: 'maxCompletions', type: 'number', required: false },
    { name: 'completionCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'emoji', type: 'text', required: false },
    { name: 'isDefault', type: 'bool', required: true, defaultValue: false },
    { name: 'createdBy', type: 'relation', required: false, collectionId: 'users' },
  ],
  indexes: [
    'CREATE INDEX idx_quests_branch_id ON quests (branchId)',
    'CREATE INDEX idx_quests_status ON quests (status)',
    'CREATE INDEX idx_quests_type ON quests (type)',
    'CREATE INDEX idx_quests_difficulty ON quests (difficulty)',
  ],
};

export const achievementsSchema = {
  name: 'achievements',
  type: 'base',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'text', required: true },
    { name: 'icon', type: 'text', required: true },
    { name: 'category', type: 'select', required: true, values: ['streak', 'milestone', 'mastery', 'challenge'] },
    { name: 'criteriaType', type: 'select', required: true, values: ['xp_total', 'level', 'quests_completed', 'streak', 'branch_complete', 'custom'] },
    { name: 'criteriaValue', type: 'number', required: true },
    { name: 'criteriaDescription', type: 'text', required: true },
    { name: 'color', type: 'text', required: false },
    { name: 'rarity', type: 'select', required: true, values: ['common', 'uncommon', 'rare', 'epic', 'legendary'], defaultValue: 'common' },
    { name: 'order', type: 'number', required: true, defaultValue: 0 },
    { name: 'isDefault', type: 'bool', required: true, defaultValue: false },
  ],
  indexes: [
    'CREATE INDEX idx_achievements_category ON achievements (category)',
    'CREATE INDEX idx_achievements_rarity ON achievements (rarity)',
  ],
};

export const userAchievementsSchema = {
  name: 'user_achievements',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'achievementId', type: 'relation', required: true, collectionId: 'achievements', cascadeDelete: true },
    { name: 'earnedAt', type: 'date', required: true },
    { name: 'levelAtTime', type: 'number', required: true },
    { name: 'xpAtTime', type: 'number', required: true },
  ],
  indexes: [
    'CREATE INDEX idx_user_achievements_user_id ON user_achievements (userId)',
    'CREATE INDEX idx_user_achievements_achievement_id ON user_achievements (achievementId)',
    'CREATE UNIQUE INDEX idx_user_achievements_unique ON user_achievements (userId, achievementId)',
  ],
};

// ─── XP & Leveling System ────────────────────────────────────────────────────

/**
 * Calculate XP needed for the next level.
 * Uses exponential curve: base * (growth ^ (level - 1))
 * Uses Math.round to avoid floating point precision issues
 * (e.g. 100 * 1.15 = 114.999... in JS, should be 115)
 */
export function calculateXPForLevel(level: number): number {
  const BASE_XP = 100;
  const GROWTH_RATE = 1.15;
  return Math.round(BASE_XP * Math.pow(GROWTH_RATE, level - 1));
}

/**
 * Calculate level from total XP.
 */
export function calculateLevelFromXP(totalXP: number): number {
  let level = 1;
  let xpNeeded = 0;
  
  while (true) {
    const xpForThisLevel = calculateXPForLevel(level);
    xpNeeded += xpForThisLevel;
    if (totalXP < xpNeeded) {
      return level;
    }
    level++;
  }
}

/**
 * Calculate XP progress toward next level.
 */
export function calculateXPProgress(totalXP: number): { current: number; needed: number; percentage: number } {
  const level = calculateLevelFromXP(totalXP);
  let xpForPreviousLevels = 0;
  
  for (let i = 1; i < level; i++) {
    xpForPreviousLevels += calculateXPForLevel(i);
  }
  
  const currentLevelXP = totalXP - xpForPreviousLevels;
  const neededForNextLevel = calculateXPForLevel(level);
  const percentage = Math.min(100, Math.round((currentLevelXP / neededForNextLevel) * 100));
  
  return {
    current: currentLevelXP,
    needed: neededForNextLevel,
    percentage,
  };
}

/**
 * XP rewards by difficulty.
 */
export const XP_REWARDS: Record<QuestType, { easy: number; medium: number; hard: number }> = {
  read: { easy: 10, medium: 25, hard: 50 },
  math: { easy: 15, medium: 30, hard: 60 },
  science: { easy: 15, medium: 35, hard: 70 },
  creative: { easy: 20, medium: 40, hard: 80 },
  life_skill: { easy: 25, medium: 50, hard: 100 },
  custom: { easy: 10, medium: 25, hard: 50 },
};

// ─── Default Data ────────────────────────────────────────────────────────────

export const DEFAULT_BRANCHES: Omit<SkillBranch, 'id' | 'createdAt'>[] = [
  {
    name: 'Math Explorer',
    icon: '🔢',
    category: 'math',
    color: '#3b82f6',
    description: 'Master numbers, patterns, and problem-solving',
    prerequisiteBranches: [],
    unlockLevel: 1,
    unlockXP: 0,
    questCount: 0,
    completedCount: 0,
    order: 1,
    isDefault: true,
  },
  {
    name: 'Word Wizard',
    icon: '📚',
    category: 'reading',
    color: '#a855f7',
    description: 'Read books, expand vocabulary, and tell stories',
    prerequisiteBranches: [],
    unlockLevel: 1,
    unlockXP: 0,
    questCount: 0,
    completedCount: 0,
    order: 2,
    isDefault: true,
  },
  {
    name: 'Science Detective',
    icon: '🔬',
    category: 'science',
    color: '#22c55e',
    description: 'Explore nature, conduct experiments, and discover how things work',
    prerequisiteBranches: [],
    unlockLevel: 2,
    unlockXP: 100,
    questCount: 0,
    completedCount: 0,
    order: 3,
    isDefault: true,
  },
  {
    name: 'Creative Genius',
    icon: '🎨',
    category: 'creative',
    color: '#f59e0b',
    description: 'Draw, paint, build, and create amazing things',
    prerequisiteBranches: [],
    unlockLevel: 1,
    unlockXP: 0,
    questCount: 0,
    completedCount: 0,
    order: 4,
    isDefault: true,
  },
  {
    name: 'Life Skills Master',
    icon: '🌟',
    category: 'life_skill',
    color: '#ec4899',
    description: 'Learn cooking, organizing, money management, and more',
    prerequisiteBranches: [],
    unlockLevel: 3,
    unlockXP: 300,
    questCount: 0,
    completedCount: 0,
    order: 5,
    isDefault: true,
  },
];

export const DEFAULT_ACHIEVEMENTS: Omit<Achievement, 'id' | 'createdAt'>[] = [
  // Streak achievements
  { name: 'First Steps', description: 'Complete your first quest', icon: '👣', category: 'milestone', criteriaType: 'quests_completed', criteriaValue: 1, criteriaDescription: 'Complete 1 quest', rarity: 'common', order: 1, isDefault: true },
  { name: 'Getting Started', description: 'Complete 5 quests', icon: '🚶', category: 'milestone', criteriaType: 'quests_completed', criteriaValue: 5, criteriaDescription: 'Complete 5 quests', rarity: 'common', order: 2, isDefault: true },
  { name: 'Quest Hunter', description: 'Complete 25 quests', icon: '🏹', category: 'milestone', criteriaType: 'quests_completed', criteriaValue: 25, criteriaDescription: 'Complete 25 quests', rarity: 'uncommon', order: 3, isDefault: true },
  { name: 'Quest Master', description: 'Complete 100 quests', icon: '⚔️', category: 'milestone', criteriaType: 'quests_completed', criteriaValue: 100, criteriaDescription: 'Complete 100 quests', rarity: 'rare', order: 4, isDefault: true },
  { name: 'Legendary Scholar', description: 'Complete 500 quests', icon: '🏆', category: 'milestone', criteriaType: 'quests_completed', criteriaValue: 500, criteriaDescription: 'Complete 500 quests', rarity: 'epic', order: 5, isDefault: true },
  
  // Level achievements
  { name: 'Rising Star', description: 'Reach level 5', icon: '⭐', category: 'milestone', criteriaType: 'level', criteriaValue: 5, criteriaDescription: 'Reach level 5', rarity: 'common', order: 10, isDefault: true },
  { name: 'Skill Seeker', description: 'Reach level 10', icon: '🌟', category: 'milestone', criteriaType: 'level', criteriaValue: 10, criteriaDescription: 'Reach level 10', rarity: 'uncommon', order: 11, isDefault: true },
  { name: 'Knowledge Knight', description: 'Reach level 25', icon: '🛡️', category: 'milestone', criteriaType: 'level', criteriaValue: 25, criteriaDescription: 'Reach level 25', rarity: 'rare', order: 12, isDefault: true },
  { name: 'Wisdom Wizard', description: 'Reach level 50', icon: '🧙', category: 'milestone', criteriaType: 'level', criteriaValue: 50, criteriaDescription: 'Reach level 50', rarity: 'epic', order: 13, isDefault: true },
  
  // Streak achievements
  { name: 'Three Day Starter', description: '3-day learning streak', icon: '🔥', category: 'streak', criteriaType: 'streak', criteriaValue: 3, criteriaDescription: '3-day streak', rarity: 'common', order: 20, isDefault: true },
  { name: 'Week Warrior', description: '7-day learning streak', icon: '🔥', category: 'streak', criteriaType: 'streak', criteriaValue: 7, criteriaDescription: '7-day streak', rarity: 'uncommon', order: 21, isDefault: true },
  { name: 'Fortnight Fighter', description: '14-day learning streak', icon: '🔥', category: 'streak', criteriaType: 'streak', criteriaValue: 14, criteriaDescription: '14-day streak', rarity: 'rare', order: 22, isDefault: true },
  { name: 'Monthly Master', description: '30-day learning streak', icon: '🔥', category: 'streak', criteriaType: 'streak', criteriaValue: 30, criteriaDescription: '30-day streak', rarity: 'epic', order: 23, isDefault: true },
  { name: 'Unstoppable', description: '100-day learning streak', icon: '🔥', category: 'streak', criteriaType: 'streak', criteriaValue: 100, criteriaDescription: '100-day streak', rarity: 'legendary', order: 24, isDefault: true },
  
  // Branch achievements
  { name: 'Math Beginner', description: 'Complete all Math Explorer quests', icon: '🔢', category: 'mastery', criteriaType: 'branch_complete', criteriaValue: 0, criteriaDescription: 'Complete Math Explorer branch', rarity: 'rare', order: 30, isDefault: true },
  { name: 'Bookworm', description: 'Complete all Word Wizard quests', icon: '📚', category: 'mastery', criteriaType: 'branch_complete', criteriaValue: 0, criteriaDescription: 'Complete Word Wizard branch', rarity: 'rare', order: 31, isDefault: true },
  { name: 'Science Star', description: 'Complete all Science Detective quests', icon: '🔬', category: 'mastery', criteriaType: 'branch_complete', criteriaValue: 0, criteriaDescription: 'Complete Science Detective branch', rarity: 'rare', order: 32, isDefault: true },
];

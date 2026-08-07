/**
 * Money Mountain - Database Types
 * 
 * Visual savings goals that show progress as a mountain to climb.
 * Kids see their savings journey gamified with milestones and achievements.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type MountainStatus = 'active' | 'completed' | 'paused';

export type TransactionType = 'deposit' | 'withdrawal' | 'match';

export type TransactionSource = 'allowance' | 'gift' | 'chore' | 'match' | 'bonus' | 'other';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface MoneyMountain {
  id: string;
  userId: string;
  name: string; // "New Bike", "Video Game"
  description?: string;
  targetAmount: number;
  currentAmount: number;
  currency: Currency;
  
  // Visual
  imageUrl?: string;
  icon?: string; // emoji
  color?: string; // hex color for mountain theme
  mountainTheme?: 'snow' | 'desert' | 'forest' | 'volcano' | 'cloud';
  
  // Status
  status: MountainStatus;
  deadline?: string; // ISO date
  isCompleted: boolean;
  completedAt?: string;
  
  // Progress
  percentageComplete: number;
  milestoneIndex: number; // current milestone reached (0-4)
  daysActive: number;
  
  // Matching
  matchEnabled: boolean;
  matchPercentage: number; // 0-100
  matchCap?: number; // max match amount
  matchedAmount: number;
  matchedBy?: string; // parent user ID
  
  // Tracking
  totalDeposits: number;
  totalWithdrawals: number;
  transactionCount: number;
  
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  mountainId: string;
  percentage: number; // 25, 50, 75, 100
  label: string; // "Base Camp", "Halfway!", "Summit Push!", "Summit Reached!"
  icon: string; // emoji
  isReached: boolean;
  reachedAt?: string;
  
  // Optional reward
  reward?: string;
  rewardRedeemed: boolean;
}

export interface MountainTransaction {
  id: string;
  mountainId: string;
  userId: string; // who made the transaction
  
  type: TransactionType;
  amount: number;
  currency: Currency;
  date: string;
  description: string;
  source: TransactionSource;
  
  // Matching
  isMatch: boolean;
  matchParentId?: string;
  originalAmount?: number; // pre-match amount
  matchAmount?: number; // match portion
  
  // Metadata
  note?: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  
  createdAt: string;
}

// ─── Parent Settings ─────────────────────────────────────────────────────────

export interface AllowanceSettings {
  id: string;
  parentId: string;
  childId: string;
  
  // Weekly allowance
  weeklyAmount: number;
  currency: Currency;
  payDay: number; // 0-6 (Sunday-Saturday)
  
  // Matching
  matchEnabled: boolean;
  matchPercentage: number; // 0-100
  matchCap?: number; // max match per mountain
  weeklyMatchCap?: number; // max match per week
  
  // Controls
  requiresApproval: boolean;
  withdrawalLimit?: number; // max per withdrawal
  weeklyWithdrawalLimit?: number;
  
  // Savings split
  spendPercent: number; // 0-100
  savePercent: number; // 0-100
  givePercent: number; // 0-100
  
  createdAt: string;
  updatedAt: string;
}

// ─── PocketBase Collection Schemas ───────────────────────────────────────────

export const moneyMountainsSchema = {
  name: 'money_mountains',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'text', required: false },
    { name: 'targetAmount', type: 'number', required: true },
    { name: 'currentAmount', type: 'number', required: true, defaultValue: 0 },
    { name: 'currency', type: 'select', required: true, values: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'], defaultValue: 'USD' },
    { name: 'imageUrl', type: 'file', required: false },
    { name: 'icon', type: 'text', required: false },
    { name: 'color', type: 'text', required: false },
    { name: 'mountainTheme', type: 'select', required: false, values: ['snow', 'desert', 'forest', 'volcano', 'cloud'] },
    { name: 'status', type: 'select', required: true, values: ['active', 'completed', 'paused'], defaultValue: 'active' },
    { name: 'deadline', type: 'date', required: false },
    { name: 'isCompleted', type: 'bool', required: true, defaultValue: false },
    { name: 'completedAt', type: 'date', required: false },
    { name: 'percentageComplete', type: 'number', required: true, defaultValue: 0 },
    { name: 'milestoneIndex', type: 'number', required: true, defaultValue: 0 },
    { name: 'daysActive', type: 'number', required: true, defaultValue: 0 },
    { name: 'matchEnabled', type: 'bool', required: true, defaultValue: false },
    { name: 'matchPercentage', type: 'number', required: true, defaultValue: 0 },
    { name: 'matchCap', type: 'number', required: false },
    { name: 'matchedAmount', type: 'number', required: true, defaultValue: 0 },
    { name: 'matchedBy', type: 'relation', required: false, collectionId: 'users' },
    { name: 'totalDeposits', type: 'number', required: true, defaultValue: 0 },
    { name: 'totalWithdrawals', type: 'number', required: true, defaultValue: 0 },
    { name: 'transactionCount', type: 'number', required: true, defaultValue: 0 },
  ],
  indexes: [
    'CREATE INDEX idx_money_mountains_user_id ON money_mountains (userId)',
    'CREATE INDEX idx_money_mountains_status ON money_mountains (status)',
    'CREATE INDEX idx_money_mountains_is_completed ON money_mountains (isCompleted)',
  ],
};

export const mountainMilestonesSchema = {
  name: 'mountain_milestones',
  type: 'base',
  fields: [
    { name: 'mountainId', type: 'relation', required: true, collectionId: 'money_mountains', cascadeDelete: true },
    { name: 'percentage', type: 'number', required: true },
    { name: 'label', type: 'text', required: true },
    { name: 'icon', type: 'text', required: true },
    { name: 'isReached', type: 'bool', required: true, defaultValue: false },
    { name: 'reachedAt', type: 'date', required: false },
    { name: 'reward', type: 'text', required: false },
    { name: 'rewardRedeemed', type: 'bool', required: true, defaultValue: false },
  ],
  indexes: [
    'CREATE INDEX idx_mountain_milestones_mountain_id ON mountain_milestones (mountainId)',
    'CREATE UNIQUE INDEX idx_mountain_milestones_unique ON mountain_milestones (mountainId, percentage)',
  ],
};

export const mountainTransactionsSchema = {
  name: 'mountain_transactions',
  type: 'base',
  fields: [
    { name: 'mountainId', type: 'relation', required: true, collectionId: 'money_mountains', cascadeDelete: true },
    { name: 'userId', type: 'relation', required: true, collectionId: 'users' },
    { name: 'type', type: 'select', required: true, values: ['deposit', 'withdrawal', 'match'] },
    { name: 'amount', type: 'number', required: true },
    { name: 'currency', type: 'select', required: true, values: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'], defaultValue: 'USD' },
    { name: 'date', type: 'date', required: true },
    { name: 'description', type: 'text', required: true },
    { name: 'source', type: 'select', required: true, values: ['allowance', 'gift', 'chore', 'match', 'bonus', 'other'] },
    { name: 'isMatch', type: 'bool', required: true, defaultValue: false },
    { name: 'matchParentId', type: 'relation', required: false, collectionId: 'users' },
    { name: 'originalAmount', type: 'number', required: false },
    { name: 'matchAmount', type: 'number', required: false },
    { name: 'note', type: 'text', required: false },
    { name: 'approved', type: 'bool', required: true, defaultValue: false },
    { name: 'approvedBy', type: 'relation', required: false, collectionId: 'users' },
    { name: 'approvedAt', type: 'date', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_mountain_tx_mountain_id ON mountain_transactions (mountainId)',
    'CREATE INDEX idx_mountain_tx_user_id ON mountain_transactions (userId)',
    'CREATE INDEX idx_mountain_tx_date ON mountain_transactions (date)',
    'CREATE INDEX idx_mountain_tx_type ON mountain_transactions (type)',
  ],
};

export const allowanceSettingsSchema = {
  name: 'allowance_settings',
  type: 'base',
  fields: [
    { name: 'parentId', type: 'relation', required: true, collectionId: 'users' },
    { name: 'childId', type: 'relation', required: true, collectionId: 'users' },
    { name: 'weeklyAmount', type: 'number', required: true, defaultValue: 0 },
    { name: 'currency', type: 'select', required: true, values: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'], defaultValue: 'USD' },
    { name: 'payDay', type: 'number', required: true, defaultValue: 5 }, // Friday
    { name: 'matchEnabled', type: 'bool', required: true, defaultValue: false },
    { name: 'matchPercentage', type: 'number', required: true, defaultValue: 50 },
    { name: 'matchCap', type: 'number', required: false },
    { name: 'weeklyMatchCap', type: 'number', required: false },
    { name: 'requiresApproval', type: 'bool', required: true, defaultValue: true },
    { name: 'withdrawalLimit', type: 'number', required: false },
    { name: 'weeklyWithdrawalLimit', type: 'number', required: false },
    { name: 'spendPercent', type: 'number', required: true, defaultValue: 50 },
    { name: 'savePercent', type: 'number', required: true, defaultValue: 40 },
    { name: 'givePercent', type: 'number', required: true, defaultValue: 10 },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_allowance_settings_unique ON allowance_settings (parentId, childId)',
  ],
};

// ─── Helper Functions ────────────────────────────────────────────────────────

export const DEFAULT_MILESTONES: Omit<Milestone, 'id' | 'mountainId' | 'isReached' | 'reachedAt' | 'rewardRedeemed'>[] = [
  { percentage: 0, label: 'Base Camp', icon: '🏕️' },
  { percentage: 25, label: 'Quarter Way!', icon: '🥾' },
  { percentage: 50, label: 'Halfway There!', icon: '⛺' },
  { percentage: 75, label: 'Summit Push!', icon: '🧗' },
  { percentage: 100, label: 'Summit Reached!', icon: '🏔️' },
];

export const MOUNTAIN_THEMES = {
  snow: { bgGradient: 'from-blue-100 to-blue-300', accent: '#93c5fd', icon: '❄️' },
  desert: { bgGradient: 'from-amber-100 to-orange-300', accent: '#fbbf24', icon: '🏜️' },
  forest: { bgGradient: 'from-green-100 to-green-300', accent: '#4ade80', icon: '🌲' },
  volcano: { bgGradient: 'from-red-200 to-orange-400', accent: '#f87171', icon: '🌋' },
  cloud: { bgGradient: 'from-purple-100 to-indigo-300', accent: '#a78bfa', icon: '☁️' },
};

export function calculatePercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

export function getMilestoneIndex(percentage: number): number {
  if (percentage >= 100) return 4;
  if (percentage >= 75) return 3;
  if (percentage >= 50) return 2;
  if (percentage >= 25) return 1;
  return 0;
}

export function formatCurrency(amount: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function calculateMatch(
  amount: number,
  matchPercentage: number,
  matchCap?: number,
): number {
  const match = amount * (matchPercentage / 100);
  return matchCap ? Math.min(match, matchCap) : match;
}

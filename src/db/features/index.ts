/**
 * Feature Database Schemas - Central Export
 * 
 * Re-exports all feature-specific database types and schemas.
 */

// Feature 1: Time Capsule
export * from './time-capsule';

// Feature 2: Skill Tree Learning
export * from './skill-tree';

// Feature 3: Money Mountain
export * from './money-mountain';

// Feature 4: Morning Briefing
export * from './morning-briefing';

// Feature 5: Family AI
export * from './family-ai';

// ─── All Collection Schemas ──────────────────────────────────────────────────

import { timeCapsulesSchema, capsuleContentsSchema } from './time-capsule';
import {
  skillTreeProfilesSchema,
  skillBranchesSchema,
  questsSchema,
  achievementsSchema,
  userAchievementsSchema,
} from './skill-tree';
import {
  moneyMountainsSchema,
  mountainMilestonesSchema,
  mountainTransactionsSchema,
  allowanceSettingsSchema,
} from './money-mountain';
import {
  dailyQuotesSchema,
  briefingPreferencesSchema,
  briefingHistorySchema,
} from './morning-briefing';
import {
  conversationsSchema,
  conversationMessagesSchema,
  proactiveSuggestionsSchema,
  aiPreferencesSchema,
  conversationFeedbackSchema,
} from './family-ai';

export const ALL_FEATURE_SCHEMAS = [
  // Time Capsule
  timeCapsulesSchema,
  capsuleContentsSchema,
  
  // Skill Tree
  skillTreeProfilesSchema,
  skillBranchesSchema,
  questsSchema,
  achievementsSchema,
  userAchievementsSchema,
  
  // Money Mountain
  moneyMountainsSchema,
  mountainMilestonesSchema,
  mountainTransactionsSchema,
  allowanceSettingsSchema,
  
  // Morning Briefing
  dailyQuotesSchema,
  briefingPreferencesSchema,
  briefingHistorySchema,
  
  // Family AI
  conversationsSchema,
  conversationMessagesSchema,
  proactiveSuggestionsSchema,
  aiPreferencesSchema,
  conversationFeedbackSchema,
] as const;

export type FeatureSchema = typeof ALL_FEATURE_SCHEMAS[number];

/**
 * Get all collection names for feature schemas.
 */
export function getFeatureCollectionNames(): string[] {
  return ALL_FEATURE_SCHEMAS.map((schema) => schema.name);
}

/**
 * Get a specific schema by collection name.
 */
export function getSchemaByName(name: string): FeatureSchema | undefined {
  return ALL_FEATURE_SCHEMAS.find((schema) => schema.name === name);
}

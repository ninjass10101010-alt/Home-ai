/**
 * Time Capsule Feature - Database Types
 * 
 * Digital time capsules where families can lock messages, photos, and predictions
 * until future dates. Creates emotional anchors and memories to look forward to.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type ContentType = 'text' | 'photo' | 'voice' | 'video';

export type CapsuleStatus = 'locked' | 'unlocked' | 'archived';

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface TimeCapsule {
  id: string;
  title: string;
  description?: string;
  unlockDate: string; // ISO date string
  createdAt: string;
  createdBy: string; // user ID
  recipients: string[]; // user IDs
  isFamilyWide: boolean;
  status: CapsuleStatus;
  
  // Metadata
  contentCount: number;
  totalSize: number; // bytes
  
  // Tracking
  unlockNotificationSent: boolean;
  viewedBy: string[]; // user IDs who viewed
  firstViewedAt?: string;
  
  // Optional fields
  unlockMessage?: string; // Message shown when unlocking
  tags?: string[];
  color?: string; // UI color theme
}

export interface CapsuleContent {
  id: string;
  capsuleId: string;
  type: ContentType;
  data: string; // text content or file path
  createdBy: string;
  createdAt: string;
  
  // Metadata
  fileName?: string;
  fileSize?: number; // bytes
  mimeType?: string;
  duration?: number; // seconds (for voice/video)
  
  // Optional
  caption?: string;
  order: number; // display order
}

// ─── PocketBase Collection Schemas ───────────────────────────────────────────

export const timeCapsulesSchema = {
  name: 'time_capsules',
  type: 'base',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'text', required: false },
    { name: 'unlockDate', type: 'date', required: true },
    { name: 'createdBy', type: 'relation', required: true, collectionId: 'users' },
    { name: 'recipients', type: 'relation', required: false, collectionId: 'users', maxSelect: null }, // array
    { name: 'isFamilyWide', type: 'bool', required: true },
    { name: 'status', type: 'select', required: true, values: ['locked', 'unlocked', 'archived'], defaultValue: 'locked' },
    { name: 'contentCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'totalSize', type: 'number', required: true, defaultValue: 0 },
    { name: 'unlockNotificationSent', type: 'bool', required: true, defaultValue: false },
    { name: 'viewedBy', type: 'relation', required: false, collectionId: 'users', maxSelect: null },
    { name: 'firstViewedAt', type: 'date', required: false },
    { name: 'unlockMessage', type: 'text', required: false },
    { name: 'tags', type: 'json', required: false },
    { name: 'color', type: 'text', required: false },
  ],
  indexes: [
    'CREATE INDEX idx_time_capsules_unlock_date ON time_capsules (unlockDate)',
    'CREATE INDEX idx_time_capsules_status ON time_capsules (status)',
    'CREATE INDEX idx_time_capsules_created_by ON time_capsules (createdBy)',
  ],
};

export const capsuleContentsSchema = {
  name: 'capsule_contents',
  type: 'base',
  fields: [
    { name: 'capsuleId', type: 'relation', required: true, collectionId: 'time_capsules', cascadeDelete: true },
    { name: 'type', type: 'select', required: true, values: ['text', 'photo', 'voice', 'video'] },
    { name: 'data', type: 'text', required: true }, // text or file path
    { name: 'createdBy', type: 'relation', required: true, collectionId: 'users' },
    { name: 'fileName', type: 'text', required: false },
    { name: 'fileSize', type: 'number', required: false },
    { name: 'mimeType', type: 'text', required: false },
    { name: 'duration', type: 'number', required: false }, // seconds
    { name: 'caption', type: 'text', required: false },
    { name: 'order', type: 'number', required: true, defaultValue: 0 },
  ],
  indexes: [
    'CREATE INDEX idx_capsule_contents_capsule_id ON capsule_contents (capsuleId)',
    'CREATE INDEX idx_capsule_contents_type ON capsule_contents (type)',
  ],
};

// ─── API Request/Response Types ──────────────────────────────────────────────

export interface CreateCapsuleRequest {
  title: string;
  description?: string;
  unlockDate: string;
  recipients?: string[];
  isFamilyWide: boolean;
  unlockMessage?: string;
  tags?: string[];
  color?: string;
}

export interface AddContentRequest {
  type: ContentType;
  data: string;
  caption?: string;
  order?: number;
}

export interface UpdateCapsuleRequest {
  title?: string;
  description?: string;
  unlockDate?: string;
  unlockMessage?: string;
  tags?: string[];
  color?: string;
}

// ─── Helper Types ────────────────────────────────────────────────────────────

export interface CapsuleWithContents extends TimeCapsule {
  contents: CapsuleContent[];
}

export interface CapsulePreview {
  id: string;
  title: string;
  unlockDate: string;
  status: CapsuleStatus;
  contentCount: number;
  daysUntilUnlock: number;
  isUnlocked: boolean;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

export function getDaysUntilUnlock(unlockDate: string): number {
  const now = new Date();
  const unlock = new Date(unlockDate);
  const diffMs = unlock.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function isCapsuleUnlocked(capsule: TimeCapsule): boolean {
  if (capsule.status === 'unlocked' || capsule.status === 'archived') {
    return true;
  }
  const now = new Date();
  const unlock = new Date(capsule.unlockDate);
  return now >= unlock;
}

export function canUserViewCapsule(capsule: TimeCapsule, userId: string): boolean {
  if (capsule.isFamilyWide) return true;
  if (capsule.createdBy === userId) return true;
  return capsule.recipients.includes(userId);
}

/**
 * Unit tests for Time Capsule utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDaysUntilUnlock,
  isCapsuleUnlocked,
  canUserViewCapsule,
} from '@/db/features/time-capsule';
import type { TimeCapsule } from '@/db/features/time-capsule';

describe('Time Capsule Utilities', () => {
  describe('getDaysUntilUnlock', () => {
    it('returns 0 for past dates', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      
      expect(getDaysUntilUnlock(pastDate.toISOString())).toBe(0);
    });

    it('returns 0 for today', () => {
      const today = new Date();
      expect(getDaysUntilUnlock(today.toISOString())).toBe(0);
    });

    it('returns correct days for future dates', () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      
      expect(getDaysUntilUnlock(future.toISOString())).toBe(10);
    });

    it('rounds up partial days', () => {
      const future = new Date();
      future.setHours(future.getHours() + 12); // 12 hours from now
      
      const days = getDaysUntilUnlock(future.toISOString());
      expect(days).toBe(1); // Should round up to 1 day
    });

    it('handles exact day boundaries', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const days = getDaysUntilUnlock(tomorrow.toISOString());
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(2);
    });
  });

  describe('isCapsuleUnlocked', () => {
    const createCapsule = (overrides: Partial<TimeCapsule> = {}): TimeCapsule => ({
      id: 'test-1',
      title: 'Test Capsule',
      unlockDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
      recipients: [],
      isFamilyWide: false,
      status: 'locked',
      contentCount: 0,
      totalSize: 0,
      unlockNotificationSent: false,
      viewedBy: [],
      ...overrides,
    });

    it('returns true when status is "unlocked"', () => {
      const capsule = createCapsule({ status: 'unlocked' });
      expect(isCapsuleUnlocked(capsule)).toBe(true);
    });

    it('returns true when status is "archived"', () => {
      const capsule = createCapsule({ status: 'archived' });
      expect(isCapsuleUnlocked(capsule)).toBe(true);
    });

    it('returns true when unlock date has passed', () => {
      const capsule = createCapsule({
        unlockDate: new Date(Date.now() - 86400000).toISOString(), // Yesterday
        status: 'locked',
      });
      expect(isCapsuleUnlocked(capsule)).toBe(true);
    });

    it('returns false when locked and unlock date is in future', () => {
      const capsule = createCapsule({
        unlockDate: new Date(Date.now() + 86400000 * 7).toISOString(), // 7 days from now
        status: 'locked',
      });
      expect(isCapsuleUnlocked(capsule)).toBe(false);
    });
  });

  describe('canUserViewCapsule', () => {
    const createCapsule = (overrides: Partial<TimeCapsule> = {}): TimeCapsule => ({
      id: 'test-1',
      title: 'Test Capsule',
      unlockDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
      recipients: ['user-2', 'user-3'],
      isFamilyWide: false,
      status: 'locked',
      contentCount: 0,
      totalSize: 0,
      unlockNotificationSent: false,
      viewedBy: [],
      ...overrides,
    });

    it('allows creator to view', () => {
      const capsule = createCapsule();
      expect(canUserViewCapsule(capsule, 'user-1')).toBe(true);
    });

    it('allows recipients to view', () => {
      const capsule = createCapsule();
      expect(canUserViewCapsule(capsule, 'user-2')).toBe(true);
      expect(canUserViewCapsule(capsule, 'user-3')).toBe(true);
    });

    it('denies non-recipients', () => {
      const capsule = createCapsule();
      expect(canUserViewCapsule(capsule, 'user-99')).toBe(false);
    });

    it('allows anyone when family-wide', () => {
      const capsule = createCapsule({ isFamilyWide: true });
      expect(canUserViewCapsule(capsule, 'user-99')).toBe(true);
      expect(canUserViewCapsule(capsule, 'random-user')).toBe(true);
    });

    it('handles empty recipients list', () => {
      const capsule = createCapsule({ recipients: [] });
      expect(canUserViewCapsule(capsule, 'user-1')).toBe(true); // Creator
      expect(canUserViewCapsule(capsule, 'user-99')).toBe(false); // Not creator
    });
  });
});

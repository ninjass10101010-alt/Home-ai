/**
 * Unit tests for dashboard mode detection logic.
 *
 * Tests the pure functions that determine which mode to render
 * based on auth state, time of day, and day of week.
 *
 * Run: npx vitest run tests/unit/useDashboardMode.test.ts
 */
import { describe, it, expect } from 'vitest';

// ─── Pure functions extracted from useDashboardMode for testability ───

type DashboardMode = 'family' | 'adult' | 'kid';

function resolveMode(isLoggedIn: boolean, role?: string): DashboardMode {
  if (!isLoggedIn) return 'family';
  if (role === 'parent') return 'adult';
  return 'kid'; // child or pet → kid mode
}

function detectBedtime(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

function detectWeekend(day: number): boolean {
  return day === 0 || day === 6;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Dashboard Mode Detection', () => {
  describe('resolveMode', () => {
    it('returns "family" when not logged in', () => {
      expect(resolveMode(false)).toBe('family');
      expect(resolveMode(false, 'parent')).toBe('family');
      expect(resolveMode(false, 'child')).toBe('family');
    });

    it('returns "adult" for logged-in parent', () => {
      expect(resolveMode(true, 'parent')).toBe('adult');
    });

    it('returns "kid" for logged-in child', () => {
      expect(resolveMode(true, 'child')).toBe('kid');
    });

    it('returns "kid" for logged-in with no role', () => {
      expect(resolveMode(true)).toBe('kid');
      expect(resolveMode(true, undefined)).toBe('kid');
    });
  });

  describe('detectBedtime', () => {
    it('returns true for late night hours', () => {
      expect(detectBedtime(20)).toBe(true);
      expect(detectBedtime(21)).toBe(true);
      expect(detectBedtime(23)).toBe(true);
    });

    it('returns true for early morning hours', () => {
      expect(detectBedtime(0)).toBe(true);
      expect(detectBedtime(1)).toBe(true);
      expect(detectBedtime(5)).toBe(true);
    });

    it('returns false for daytime hours', () => {
      expect(detectBedtime(6)).toBe(false);
      expect(detectBedtime(12)).toBe(false);
      expect(detectBedtime(19)).toBe(false);
    });

    it('boundary: 6am is NOT bedtime', () => {
      expect(detectBedtime(6)).toBe(false);
    });

    it('boundary: 8pm IS bedtime', () => {
      expect(detectBedtime(20)).toBe(true);
    });
  });

  describe('detectWeekend', () => {
    it('returns true for Sunday (0)', () => {
      expect(detectWeekend(0)).toBe(true);
    });

    it('returns true for Saturday (6)', () => {
      expect(detectWeekend(6)).toBe(true);
    });

    it('returns false for weekdays', () => {
      expect(detectWeekend(1)).toBe(false); // Monday
      expect(detectWeekend(2)).toBe(false); // Tuesday
      expect(detectWeekend(3)).toBe(false); // Wednesday
      expect(detectWeekend(4)).toBe(false); // Thursday
      expect(detectWeekend(5)).toBe(false); // Friday
    });
  });
});

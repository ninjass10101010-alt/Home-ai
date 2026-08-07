/**
 * Unit tests for Skill Tree utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  calculateXPForLevel,
  calculateLevelFromXP,
  calculateXPProgress,
} from '@/db/features/skill-tree';

describe('Skill Tree Utilities', () => {
  describe('calculateXPForLevel', () => {
    it('returns base XP for level 1', () => {
      expect(calculateXPForLevel(1)).toBe(100);
    });

    it('increases XP requirement with level', () => {
      const level1 = calculateXPForLevel(1);
      const level5 = calculateXPForLevel(5);
      const level10 = calculateXPForLevel(10);
      
      expect(level5).toBeGreaterThan(level1);
      expect(level10).toBeGreaterThan(level5);
    });

    it('follows exponential growth curve', () => {
      // Growth rate is 1.15, so each level should be ~15% more than previous
      const level1 = calculateXPForLevel(1);
      const level2 = calculateXPForLevel(2);
      
      const ratio = level2 / level1;
      expect(ratio).toBeCloseTo(1.15, 1);
    });

    it('returns integer values', () => {
      expect(Number.isInteger(calculateXPForLevel(1))).toBe(true);
      expect(Number.isInteger(calculateXPForLevel(5))).toBe(true);
      expect(Number.isInteger(calculateXPForLevel(10))).toBe(true);
    });
  });

  describe('calculateLevelFromXP', () => {
    it('returns level 1 for 0 XP', () => {
      expect(calculateLevelFromXP(0)).toBe(1);
    });

    it('returns level 1 for XP less than level 1 requirement', () => {
      expect(calculateLevelFromXP(50)).toBe(1);
      expect(calculateLevelFromXP(99)).toBe(1);
    });

    it('returns level 2 when XP exceeds level 1 requirement', () => {
      expect(calculateLevelFromXP(100)).toBe(2);
      expect(calculateLevelFromXP(150)).toBe(2);
    });

    it('calculates correct level for higher XP', () => {
      // Level 1 requires 100 XP
      // Level 2 requires 115 XP (100 * 1.15)
      // Total for level 2: 215 XP
      expect(calculateLevelFromXP(215)).toBe(3);
    });

    it('handles very large XP values', () => {
      const level = calculateLevelFromXP(10000);
      expect(level).toBeGreaterThan(10);
    });

    it('never returns level 0 or negative', () => {
      expect(calculateLevelFromXP(0)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calculateXPProgress', () => {
    it('returns correct structure', () => {
      const result = calculateXPProgress(50);
      
      expect(result).toHaveProperty('current');
      expect(result).toHaveProperty('needed');
      expect(result).toHaveProperty('percentage');
    });

    it('calculates progress at level 1', () => {
      const result = calculateXPProgress(50);
      
      expect(result.current).toBe(50);
      expect(result.needed).toBe(100);
      expect(result.percentage).toBe(50);
    });

    it('calculates progress at level 2', () => {
      // Level 1 = 100 XP, Level 2 = 115 XP
      // At 150 total XP: current = 50 (150 - 100), needed = 115
      const result = calculateXPProgress(150);
      
      expect(result.current).toBe(50);
      expect(result.needed).toBe(115);
    });

    it('caps percentage at 100%', () => {
      // If somehow XP exceeds needed, should cap at 100
      const result = calculateXPProgress(200); // Well past level 1
      
      expect(result.percentage).toBeLessThanOrEqual(100);
    });

    it('returns 0% for 0 XP', () => {
      const result = calculateXPProgress(0);
      
      expect(result.percentage).toBe(0);
    });

    it('handles XP exactly at level boundary', () => {
      const result = calculateXPProgress(100); // Exactly level 1 complete
      
      expect(result.percentage).toBe(0); // Should be 0% into level 2
    });
  });
});

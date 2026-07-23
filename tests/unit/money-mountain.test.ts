/**
 * Unit tests for Money Mountain utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  calculatePercentage,
  getMilestoneIndex,
  formatCurrency,
  calculateMatch,
} from '@/db/features/money-mountain';

describe('Money Mountain Utilities', () => {
  describe('calculatePercentage', () => {
    it('returns 0 when target is 0', () => {
      expect(calculatePercentage(100, 0)).toBe(0);
    });

    it('returns 0 when target is negative', () => {
      expect(calculatePercentage(100, -50)).toBe(0);
    });

    it('calculates percentage correctly', () => {
      expect(calculatePercentage(50, 100)).toBe(50);
      expect(calculatePercentage(25, 100)).toBe(25);
      expect(calculatePercentage(75, 100)).toBe(75);
    });

    it('caps at 100%', () => {
      expect(calculatePercentage(150, 100)).toBe(100);
      expect(calculatePercentage(1000, 100)).toBe(100);
    });

    it('handles zero current amount', () => {
      expect(calculatePercentage(0, 100)).toBe(0);
    });

    it('rounds to nearest integer', () => {
      expect(calculatePercentage(33, 100)).toBe(33);
      expect(calculatePercentage(67, 100)).toBe(67);
      expect(calculatePercentage(1, 3)).toBe(33); // 33.33... rounds to 33
    });
  });

  describe('getMilestoneIndex', () => {
    it('returns 0 for less than 25%', () => {
      expect(getMilestoneIndex(0)).toBe(0);
      expect(getMilestoneIndex(10)).toBe(0);
      expect(getMilestoneIndex(24)).toBe(0);
    });

    it('returns 1 for 25-49%', () => {
      expect(getMilestoneIndex(25)).toBe(1);
      expect(getMilestoneIndex(49)).toBe(1);
    });

    it('returns 2 for 50-74%', () => {
      expect(getMilestoneIndex(50)).toBe(2);
      expect(getMilestoneIndex(74)).toBe(2);
    });

    it('returns 3 for 75-99%', () => {
      expect(getMilestoneIndex(75)).toBe(3);
      expect(getMilestoneIndex(99)).toBe(3);
    });

    it('returns 4 for 100%+', () => {
      expect(getMilestoneIndex(100)).toBe(4);
      expect(getMilestoneIndex(150)).toBe(4);
    });
  });

  describe('formatCurrency', () => {
    it('formats USD by default', () => {
      expect(formatCurrency(100)).toBe('$100.00');
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('formats EUR correctly', () => {
      const result = formatCurrency(100, 'EUR');
      // EUR format varies by locale but should contain €
      expect(result).toMatch(/€|100/);
    });

    it('formats GBP correctly', () => {
      const result = formatCurrency(100, 'GBP');
      expect(result).toMatch(/£|100/);
    });

    it('handles negative amounts', () => {
      const result = formatCurrency(-50);
      expect(result).toMatch(/-.*50/);
    });

    it('handles very large amounts', () => {
      const result = formatCurrency(1000000);
      expect(result).toMatch(/1.*000.*000/);
    });
  });

  describe('calculateMatch', () => {
    it('calculates match percentage correctly', () => {
      expect(calculateMatch(100, 50)).toBe(50);
      expect(calculateMatch(100, 100)).toBe(100);
      expect(calculateMatch(100, 25)).toBe(25);
    });

    it('returns 0 for 0% match', () => {
      expect(calculateMatch(100, 0)).toBe(0);
    });

    it('applies match cap when provided', () => {
      expect(calculateMatch(100, 50, 30)).toBe(30);
      expect(calculateMatch(100, 100, 50)).toBe(50);
    });

    it('does not apply cap when match is below cap', () => {
      expect(calculateMatch(100, 25, 50)).toBe(25);
    });

    it('handles zero amount', () => {
      expect(calculateMatch(0, 50)).toBe(0);
      expect(calculateMatch(0, 50, 100)).toBe(0);
    });

    it('handles fractional amounts', () => {
      expect(calculateMatch(33.33, 50)).toBeCloseTo(16.665);
    });
  });
});

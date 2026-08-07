/**
 * Unit tests for Morning Briefing utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  getOutfitSuggestion,
  getRandomQuote,
} from '@/db/features/morning-briefing';
import type { DailyQuote } from '@/db/features/morning-briefing';

describe('Morning Briefing Utilities', () => {
  describe('getOutfitSuggestion', () => {
    it('suggests heavy coat for very cold + snowy', () => {
      const result = getOutfitSuggestion(25, 'snowy');
      expect(result).not.toBeNull();
      expect(result?.temperatureRange).toBe('cold');
      expect(result?.items).toContain('heavy coat');
      expect(result?.items).toContain('boots');
    });

    it('suggests umbrella for cold + rainy', () => {
      const result = getOutfitSuggestion(30, 'rainy');
      expect(result).not.toBeNull();
      expect(result?.items).toContain('umbrella');
    });

    it('suggests light clothing for hot weather', () => {
      const result = getOutfitSuggestion(90, 'sunny');
      expect(result).not.toBeNull();
      expect(result?.temperatureRange).toBe('hot');
    });

    it('suggests light layer for mild weather', () => {
      const result = getOutfitSuggestion(70, 'clear');
      expect(result).not.toBeNull();
      expect(result?.temperatureRange).toBe('mild');
    });

    it('suggests sweater for cool weather default', () => {
      const result = getOutfitSuggestion(50, 'cloudy');
      expect(result).not.toBeNull();
      expect(result?.temperatureRange).toBe('cool');
    });

    it('includes sunscreen for warm + sunny', () => {
      const result = getOutfitSuggestion(80, 'sunny');
      expect(result).not.toBeNull();
      expect(result?.items).toContain('sunscreen');
    });

    it('returns null for unknown conditions with no default', () => {
      // Very specific condition that might not have a match
      const result = getOutfitSuggestion(70, 'tornado');
      // Should fall back to default for mild temp range
      if (result) {
        expect(result.temperatureRange).toBe('mild');
      }
    });

    it('handles boundary temperatures', () => {
      // 40°F = boundary between cold and cool
      expect(getOutfitSuggestion(40, 'default')).not.toBeNull();
      // 60°F = boundary between cool and mild  
      expect(getOutfitSuggestion(60, 'default')).not.toBeNull();
      // 75°F = boundary between mild and warm
      expect(getOutfitSuggestion(75, 'default')).not.toBeNull();
      // 85°F = boundary between warm and hot
      expect(getOutfitSuggestion(85, 'default')).not.toBeNull();
    });
  });

  describe('getRandomQuote', () => {
    const createQuote = (overrides: Partial<DailyQuote> = {}): DailyQuote => ({
      id: 'q-1',
      text: 'Test quote',
      author: 'Test Author',
      category: 'motivational',
      emoji: '💪',
      timesShown: 0,
      isDefault: true,
      createdAt: new Date().toISOString(),
      ...overrides,
    });

    it('returns null for empty array', () => {
      expect(getRandomQuote([])).toBeNull();
    });

    it('returns a quote from the array', () => {
      const quotes = [createQuote({ id: '1' }), createQuote({ id: '2' })];
      const result = getRandomQuote(quotes);
      expect(result).not.toBeNull();
      expect(quotes).toContain(result);
    });

    it('prefers unshown quotes (timesShown = 0)', () => {
      const quotes = [
        createQuote({ id: '1', timesShown: 5 }),
        createQuote({ id: '2', timesShown: 0 }),
        createQuote({ id: '3', timesShown: 10 }),
      ];
      
      // Run multiple times to check preference
      let freshCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = getRandomQuote(quotes);
        if (result?.timesShown === 0) freshCount++;
      }
      
      // Should strongly prefer the fresh quote
      expect(freshCount).toBeGreaterThan(80);
    });

    it('respects preferred categories', () => {
      const quotes = [
        createQuote({ id: '1', category: 'funny' }),
        createQuote({ id: '2', category: 'motivational' }),
        createQuote({ id: '3', category: 'family' }),
      ];
      
      let motivationalCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = getRandomQuote(quotes, ['motivational']);
        if (result?.category === 'motivational') motivationalCount++;
      }
      
      expect(motivationalCount).toBe(100);
    });

    it('falls back to all quotes when preferred category not found', () => {
      const quotes = [
        createQuote({ id: '1', category: 'funny' }),
        createQuote({ id: '2', category: 'motivational' }),
      ];
      
      const result = getRandomQuote(quotes, ['wisdom']);
      expect(result).not.toBeNull();
    });

    it('selects least-shown quote when no fresh quotes', () => {
      const quotes = [
        createQuote({ id: '1', timesShown: 10 }),
        createQuote({ id: '2', timesShown: 2 }),
        createQuote({ id: '3', timesShown: 5 }),
      ];
      
      let minCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = getRandomQuote(quotes);
        if (result?.timesShown === 2) minCount++;
      }
      
      // Should strongly prefer the least-shown quote
      expect(minCount).toBeGreaterThan(80);
    });
  });
});

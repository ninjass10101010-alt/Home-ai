/**
 * Unit tests for home layout orientation classes.
 *
 * Landscape mode must drive the bento grid visuals, not just widget order:
 * on a narrow landscape viewport (<1024px wide, e.g. phone held sideways)
 * the 3-column bento and its col-spans must still apply, because the CSS
 * `lg:` breakpoint never matches there.
 *
 * Run: npx vitest run tests/unit/layout-config.test.ts
 */
import { describe, it, expect } from 'vitest';
import { homeGridClass, widgetSpanClass, homeFooterSpanClass, WIDGET_SPANS } from '@/lib/layout-config';

describe('homeGridClass', () => {
  it('renders the 3-column bento when orientation is landscape', () => {
    const cls = homeGridClass('landscape');
    expect(cls).toContain('grid-cols-3');
    expect(cls).toContain('auto-rows-min');
  });

  it('renders a single column when orientation is portrait', () => {
    const cls = homeGridClass('portrait');
    expect(cls).toContain('grid-cols-1');
    expect(cls).not.toContain('grid-cols-3');
  });
});

describe('widgetSpanClass', () => {
  it('applies spans in landscape so the bento tiles correctly', () => {
    expect(widgetSpanClass('weather', 'landscape')).toBe('col-span-3');
    expect(widgetSpanClass('consuelaSuggestions', 'landscape')).toBe('col-span-2');
    expect(widgetSpanClass('leaderboard', 'landscape')).toBe('col-span-1');
  });

  it('applies no spans in portrait (single-column stack)', () => {
    expect(widgetSpanClass('weather', 'portrait')).toBe('');
    expect(widgetSpanClass('leaderboard', 'portrait')).toBe('');
  });

  it('falls back to col-span-1 for unknown widgets in landscape', () => {
    expect(widgetSpanClass('bogus' as never, 'landscape')).toBe('col-span-1');
  });
});

describe('homeFooterSpanClass', () => {
  it('spans the full bento width in landscape', () => {
    expect(homeFooterSpanClass('landscape')).toBe('col-span-3');
  });

  it('spans nothing in portrait', () => {
    expect(homeFooterSpanClass('portrait')).toBe('');
  });
});

describe('WIDGET_SPANS', () => {
  it('are not lg:-prefixed — they must take effect below 1024px', () => {
    for (const span of Object.values(WIDGET_SPANS)) {
      expect(span.startsWith('lg:')).toBe(false);
    }
  });
});

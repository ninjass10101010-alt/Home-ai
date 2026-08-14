/**
 * Unit tests for home layout modes (phone / tablet / desktop) + migration.
 *
 * Run: npx vitest run tests/unit/layout-config.test.ts
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  homeGridClass,
  widgetSpanClass,
  homeFooterSpanClass,
  WIDGET_SPANS,
  computeLayoutMode,
  cloneDefaultLayout,
  loadLayoutConfig,
  saveLayoutConfig,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  type WidgetId,
} from '@/lib/layout-config';

describe('computeLayoutMode', () => {
  it('maps landscape to desktop at any width', () => {
    expect(computeLayoutMode(false, 390)).toBe('desktop');
    expect(computeLayoutMode(false, 1024)).toBe('desktop');
    expect(computeLayoutMode(false, 1440)).toBe('desktop');
  });

  it('maps portrait <700px to phone', () => {
    expect(computeLayoutMode(true, 390)).toBe('phone');
    expect(computeLayoutMode(true, 699)).toBe('phone');
  });

  it('maps portrait 700-1279px to tablet (iPad mini 744, iPad 810, Nest Hub 1024)', () => {
    expect(computeLayoutMode(true, 700)).toBe('tablet');
    expect(computeLayoutMode(true, 744)).toBe('tablet');
    expect(computeLayoutMode(true, 810)).toBe('tablet');
    expect(computeLayoutMode(true, 1024)).toBe('tablet');
    expect(computeLayoutMode(true, 1279)).toBe('tablet');
  });

  it('maps portrait >=1280px to desktop', () => {
    expect(computeLayoutMode(true, 1280)).toBe('desktop');
    expect(computeLayoutMode(true, 1440)).toBe('desktop');
  });
});

describe('homeGridClass', () => {
  it('renders the single-column stack for phone', () => {
    const cls = homeGridClass('phone');
    expect(cls).toContain('grid-cols-1');
    expect(cls).not.toContain('grid-cols-2');
    expect(cls).not.toContain('flex');
  });

  it('renders the 2-column bento for tablet', () => {
    const cls = homeGridClass('tablet');
    expect(cls).toContain('grid-cols-2');
    expect(cls).toContain('auto-rows-min');
    expect(cls).not.toContain('flex');
    expect(cls).not.toContain('grid-cols-3');
  });

  it('renders the horizontal filmstrip for desktop', () => {
    const cls = homeGridClass('desktop');
    expect(cls).toContain('flex');
    expect(cls).toContain('overflow-x-auto');
    expect(cls).toContain('snap-x');
  });
});

describe('widgetSpanClass', () => {
  it('applies no spans in phone (single-column stack)', () => {
    expect(widgetSpanClass('weather', 'phone')).toBe('');
    expect(widgetSpanClass('leaderboard', 'phone')).toBe('');
  });

  it('applies 1-col spans in tablet so every widget pairs up evenly', () => {
    expect(widgetSpanClass('morningBriefing', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('weather', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('consuelaSuggestions', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('leaderboard', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('tasks', 'tablet')).toBe('col-span-1');
  });

  it('applies the uniform filmstrip width in desktop', () => {
    expect(widgetSpanClass('weather', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
    expect(widgetSpanClass('leaderboard', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
    expect(widgetSpanClass('currentMeal', 'desktop')).toBe('shrink-0 snap-start w-[360px]');
  });

  it('falls back safely for unknown ids', () => {
    expect(widgetSpanClass('bogus' as never, 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('bogus' as never, 'desktop')).toBe('shrink-0 snap-start w-[360px]');
  });
});

describe('homeFooterSpanClass', () => {
  it('spans nothing in phone', () => {
    expect(homeFooterSpanClass('phone')).toBe('');
  });

  it('spans the full 2-col row in tablet', () => {
    expect(homeFooterSpanClass('tablet')).toBe('col-span-2');
  });

  it('is a filmstrip item in desktop', () => {
    expect(homeFooterSpanClass('desktop')).toBe('shrink-0 snap-start w-[360px]');
  });
});

describe('pre-mount fallback (WIDGET_SPANS)', () => {
  it('every widget falls back to a uniform col-span-1', () => {
    for (const id of Object.keys(WIDGET_SPANS)) {
      expect(WIDGET_SPANS[id as WidgetId]).toBe('col-span-1');
    }
  });
});

describe('cloneDefaultLayout', () => {
  it('returns all three modes with independent arrays', () => {
    const a = cloneDefaultLayout();
    const b = cloneDefaultLayout();
    a.phone.widgets.push('morningBriefing');
    expect(a.phone.widgets).toHaveLength(10);
    expect(b.phone.widgets).toHaveLength(9);
    expect(a.tablet.widgets).toEqual(DEFAULT_LAYOUT.phone.widgets);
    expect(a.desktop.widgets).toEqual(DEFAULT_LAYOUT.desktop.widgets);
  });
});

describe('layout migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates v1 { widgets } into all three modes', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ widgets: ['tasks', 'weather'] }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets[0]).toBe('morningBriefing');
    expect(cfg.phone.widgets).toContain('tasks');
    expect(cfg.phone.widgets).toContain('weather');
    expect(new Set(cfg.phone.widgets).size).toBe(9);
    expect(new Set(cfg.tablet.widgets).size).toBe(9);
    expect(new Set(cfg.desktop.widgets).size).toBe(9);
  });

  it('migrates v2 { portrait, landscape }: phone=portrait, desktop=landscape, tablet=portrait order', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      portrait: { widgets: ['weather', 'aiQuickAsk', 'leaderboard'] },
      landscape: { widgets: ['schedule', 'tasks'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets.slice(0, 3)).toEqual(['morningBriefing', 'consuelaSuggestions', 'weather']);
    expect(cfg.phone.widgets).toContain('aiQuickAsk');
    expect(cfg.desktop.widgets[0]).toBe('morningBriefing');
    expect(cfg.desktop.widgets.indexOf('schedule')).toBeLessThan(cfg.desktop.widgets.indexOf('tasks'));
    expect(cfg.tablet.widgets[0]).toBe('morningBriefing');
    expect(cfg.tablet.widgets.slice(1, 3)).toEqual(['consuelaSuggestions', 'weather']);
    expect(cfg.tablet.widgets).toContain('aiQuickAsk');
    expect(cfg.tablet.widgets).toEqual(cfg.phone.widgets);
  });

  it('round-trips a v3 { phone, tablet, desktop } config', () => {
    const cfg = cloneDefaultLayout();
    cfg.tablet.widgets = ['weather', 'tasks'];
    saveLayoutConfig(cfg);
    const loaded = loadLayoutConfig();
    expect(loaded.tablet.widgets).toEqual(['weather', 'tasks']);
    expect(loaded.phone.widgets).toEqual(cloneDefaultLayout().phone.widgets);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, '{not json');
    expect(loadLayoutConfig()).toEqual(cloneDefaultLayout());
  });
});
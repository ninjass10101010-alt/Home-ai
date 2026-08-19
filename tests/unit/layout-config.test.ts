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
  tabletSpan,
  tabletSpanFor,
  WIDGET_SPANS,
  computeLayoutMode,
  cloneDefaultLayout,
  loadLayoutConfig,
  saveLayoutConfig,
  DEFAULT_LAYOUT,
  HOME_GRID_FALLBACK,
  LAYOUT_STORAGE_KEY,
  moveWidgetUp,
  moveWidgetDown,
  toggleWidgetVisibility,
  getVisibleWidgets,
  getOrderedWidgetDefs,
  getHiddenWidgetDefs,
  type WidgetId,
  type WidgetDef,
  type OrientationLayout,
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
    expect(cls).toContain('auto-rows-[350px]');
    expect(cls).toContain('grid-flow-dense');
    expect(cls).not.toContain('auto-rows-min');
  });

  it('renders the auto-fit tiling grid for desktop', () => {
    const cls = homeGridClass('desktop');
    expect(cls).toContain('grid');
    expect(cls).toContain('auto-rows-[350px]');
    expect(cls).toContain('grid-flow-dense');
    expect(cls).toContain('gap-6');
    expect(cls).toContain('grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
    expect(cls).not.toContain('auto-rows-min');
    expect(cls).not.toContain('flex');
    expect(cls).not.toContain('overflow-x-auto');
  });

  it('falls back to a responsive grid with tier-aware rows', () => {
    expect(HOME_GRID_FALLBACK).toContain('lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]');
    expect(HOME_GRID_FALLBACK).toContain('md:grid-cols-2');
    expect(HOME_GRID_FALLBACK).toContain('md:auto-rows-[350px]');
    expect(HOME_GRID_FALLBACK).toContain('md:grid-flow-dense');
    expect(HOME_GRID_FALLBACK).toContain('lg:auto-rows-[350px]');
    expect(HOME_GRID_FALLBACK).toContain('lg:grid-flow-dense');
  });
});

describe('widgetSpanClass', () => {
  it('applies no spans in phone (single-column stack)', () => {
    expect(widgetSpanClass('weather', 'phone')).toBe('');
    expect(widgetSpanClass('leaderboard', 'phone')).toBe('');
  });

  it('makes weather a uniform 1×1 widget on tablet and desktop', () => {
    expect(widgetSpanClass('weather', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('weather', 'desktop')).toBe('col-span-1 max-[743px]:col-span-1');
  });

  it('keeps every other widget a uniform 1×1', () => {
    expect(widgetSpanClass('morningBriefing', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('consuelaSuggestions', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('leaderboard', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('tasks', 'tablet')).toBe('col-span-1');
    expect(widgetSpanClass('morningBriefing', 'desktop')).toBe('');
    expect(widgetSpanClass('leaderboard', 'desktop')).toBe('');
    expect(widgetSpanClass('currentMeal', 'desktop')).toBe('');
  });

  it('falls back safely for unknown ids', () => {
    expect(widgetSpanClass('bogus' as never, 'tablet')).toBe('');
    expect(widgetSpanClass('bogus' as never, 'desktop')).toBe('');
  });
});

describe('homeFooterSpanClass', () => {
  it('spans nothing in phone', () => {
    expect(homeFooterSpanClass('phone')).toBe('');
  });

  it('spans the full 2-col row in tablet', () => {
    expect(homeFooterSpanClass('tablet')).toBe('col-span-2');
  });

  it('spans the full row in desktop', () => {
    expect(homeFooterSpanClass('desktop')).toBe('col-span-full');
  });
});

describe('tabletSpan', () => {
  it('keeps every widget col-span-1 when the visible count is even', () => {
    expect(tabletSpan(0, 8)).toBe('col-span-1');
    expect(tabletSpan(3, 8)).toBe('col-span-1');
    expect(tabletSpan(7, 8)).toBe('col-span-1');
  });

  it('stretches the last widget to the full row when the count is odd', () => {
    expect(tabletSpan(0, 9)).toBe('col-span-1');
    expect(tabletSpan(5, 9)).toBe('col-span-1');
    expect(tabletSpan(8, 9)).toBe('col-span-2');
  });

  it('stretches a single widget to the full row', () => {
    expect(tabletSpan(0, 1)).toBe('col-span-2');
  });
});

describe('tabletSpanFor (tier-aware, hole-free with the weather hero)', () => {
  const defs = (ids: WidgetId[]): WidgetDef[] => ids.map((id) => ({ id, label: id, emoji: 'x', description: '' }));
  const defaultNine = defs(['morningBriefing', 'weather', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks']);
  const eightNoWeather = defs(['morningBriefing', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks']);
  const eightWithWeather = defs(['morningBriefing', 'weather', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'schedule', 'currentMeal', 'tasks']); // todayEvents hidden → 7 one-by-ones

  it('weather is a uniform 1×1 widget at any position', () => {
    // With weather now 1×1 uniform, it behaves like any other widget.
    // Count of 1×1 widgets in defaultNine = 9 (odd), so the last widget stretches.
    expect(tabletSpanFor('weather', 1, defaultNine)).toBe('col-span-1'); // not last
    expect(tabletSpanFor('weather', 0, defs(['weather']))).toBe('col-span-2'); // only widget, count=1 odd, last → stretch
    expect(tabletSpanFor('weather', 2, defs(['tasks', 'morningBriefing', 'weather']))).toBe('col-span-2'); // 3 widgets, count=3 odd, last at index 2 → stretch
  });

  it('stretches the last widget of the default 9 when the 1×1 count is odd', () => {
    // With weather now 1×1 uniform, defaultNine has 9 one-by-ones (odd count),
    // so the last widget (tasks at index 8) stretches to fill the row.
    expect(tabletSpanFor('tasks', 8, defaultNine)).toBe('col-span-2');
  });

  it('does not stretch when all 8 visible are one-by-ones (even)', () => {
    expect(tabletSpanFor('tasks', 7, eightNoWeather)).toBe('col-span-1');
  });

  it('does not stretch when all visible are one-by-ones (even count)', () => {
    // With weather now 1×1 uniform, eightWithWeather = 8 one-by-ones (even count),
    // so no widget stretches.
    expect(tabletSpanFor('tasks', 7, eightWithWeather)).toBe('col-span-1');
    expect(tabletSpanFor('currentMeal', 6, eightWithWeather)).toBe('col-span-1');
  });

  it('stretches a lone one-by-one widget to the full row', () => {
    expect(tabletSpanFor('tasks', 0, defs(['tasks']))).toBe('col-span-2');
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
  it('returns all three modes with independent arrays and empty hidden', () => {
    const a = cloneDefaultLayout();
    const b = cloneDefaultLayout();
    a.phone.widgets.push('morningBriefing');
    a.phone.hidden.push('tasks');
    expect(a.phone.widgets).toHaveLength(10);
    expect(a.phone.hidden).toEqual(['tasks']);
    expect(b.phone.hidden).toEqual([]);
    expect(a.tablet.widgets).toEqual(DEFAULT_LAYOUT.phone.widgets);
    expect(a.desktop.widgets).toEqual(DEFAULT_LAYOUT.desktop.widgets);
  });
});

describe('v4 storage (full order + hidden)', () => {
  const base: OrientationLayout = {
    widgets: ['morningBriefing', 'weather', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks'],
    hidden: [],
  };

  it('toggleWidgetVisibility adds to hidden without touching order', () => {
    const next = toggleWidgetVisibility(base, 'weather');
    expect(next.widgets).toEqual(base.widgets);
    expect(next.hidden).toEqual(['weather']);
  });

  it('toggleWidgetVisibility removes from hidden on the second toggle', () => {
    const next = toggleWidgetVisibility(toggleWidgetVisibility(base, 'weather'), 'weather');
    expect(next.hidden).toEqual([]);
    expect(next.widgets).toEqual(base.widgets);
  });

  it('getVisibleWidgets filters hidden and preserves order', () => {
    const next = toggleWidgetVisibility(base, 'weather');
    const visible = getVisibleWidgets(next);
    expect(visible.map((w) => w.id)).toEqual(['morningBriefing', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal', 'tasks']);
  });

  it('getOrderedWidgetDefs returns all 9 in order including hidden', () => {
    const next = toggleWidgetVisibility(base, 'tasks');
    expect(getOrderedWidgetDefs(next).map((w) => w.id)).toEqual(base.widgets);
  });

  it('getHiddenWidgetDefs returns hidden defs in master order', () => {
    const next = toggleWidgetVisibility(base, 'tasks');
    expect(getHiddenWidgetDefs(next).map((w) => w.id)).toEqual(['tasks']);
  });

  it('moveWidgetUp/Down operate on the full order (hidden rows reorder too)', () => {
    const withHidden = { ...base, hidden: ['tasks'] };
    const up = moveWidgetUp(withHidden.widgets, 'tasks');
    expect(up.indexOf('tasks')).toBe(base.widgets.indexOf('tasks') - 1);
    const down = moveWidgetDown(withHidden.widgets, 'weather');
    expect(down.indexOf('weather')).toBe(base.widgets.indexOf('weather') + 1);
  });
});

describe('v4 layout migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates v1 { widgets } into all three modes with hidden = missing', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ widgets: ['tasks', 'weather'] }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets[0]).toBe('morningBriefing');
    expect(cfg.phone.widgets).toContain('tasks');
    expect(cfg.phone.widgets).toContain('weather');
    expect(new Set(cfg.phone.widgets).size).toBe(9);
    expect(cfg.phone.hidden).toEqual(expect.arrayContaining(['morningBriefing', 'aiQuickAsk', 'consuelaSuggestions', 'leaderboard', 'todayEvents', 'schedule', 'currentMeal']));
    expect(cfg.tablet.widgets).toEqual(cfg.phone.widgets);
    expect(cfg.tablet.hidden).toEqual(cfg.phone.hidden);
  });

  it('migrates v2 { portrait, landscape } preserving order and hidden', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      portrait: { widgets: ['weather', 'aiQuickAsk', 'leaderboard'] },
      landscape: { widgets: ['schedule', 'tasks'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets.slice(0, 2)).toEqual(['morningBriefing', 'consuelaSuggestions']);
    expect(cfg.phone.widgets.indexOf('weather')).toBeLessThan(cfg.phone.widgets.indexOf('aiQuickAsk'));
    expect(cfg.phone.widgets.indexOf('aiQuickAsk')).toBeLessThan(cfg.phone.widgets.indexOf('leaderboard'));
    expect(cfg.phone.hidden).toHaveLength(6);
    expect(cfg.desktop.widgets.indexOf('schedule')).toBeLessThan(cfg.desktop.widgets.indexOf('tasks'));
    expect(cfg.desktop.hidden).toHaveLength(7);
  });

  it('migrates v3 { phone, tablet, desktop } visible-only lists', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      phone: { widgets: ['weather', 'tasks'] },
      tablet: { widgets: ['tasks', 'weather'] },
      desktop: { widgets: ['weather'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.widgets).toEqual(['morningBriefing', 'consuelaSuggestions', 'weather', 'tasks', 'aiQuickAsk', 'leaderboard', 'currentMeal', 'schedule', 'todayEvents']);
    expect(cfg.phone.hidden).toHaveLength(7);
    expect(cfg.tablet.widgets).toEqual(['morningBriefing', 'consuelaSuggestions', 'tasks', 'weather', 'aiQuickAsk', 'leaderboard', 'currentMeal', 'schedule', 'todayEvents']);
    expect(cfg.tablet.hidden).toHaveLength(7);
    expect(cfg.desktop.widgets).toEqual(['morningBriefing', 'consuelaSuggestions', 'weather', 'aiQuickAsk', 'leaderboard', 'currentMeal', 'schedule', 'tasks', 'todayEvents']);
    expect(cfg.desktop.hidden).toHaveLength(8);
  });

  it('self-heals a partial v4 config (hidden preserved, missing widgets appended)', () => {
    const cfg = cloneDefaultLayout();
    cfg.tablet.widgets = ['tasks', 'weather', 'morningBriefing'];
    cfg.tablet.hidden = ['aiQuickAsk', 'leaderboard'];
    saveLayoutConfig(cfg);
    const loaded = loadLayoutConfig();
    expect(loaded.tablet.widgets).toEqual(['tasks', 'consuelaSuggestions', 'weather', 'morningBriefing', 'aiQuickAsk', 'leaderboard', 'currentMeal', 'schedule', 'todayEvents']);
    expect(loaded.tablet.hidden).toEqual(['aiQuickAsk', 'leaderboard']);
  });

  it('round-trips a full v4 config exactly (the shape the app writes)', () => {
    const cfg = cloneDefaultLayout();
    cfg.phone.widgets = ['leaderboard', 'tasks', 'morningBriefing', 'todayEvents', 'schedule', 'aiQuickAsk', 'weather', 'consuelaSuggestions', 'currentMeal'];
    cfg.phone.hidden = ['schedule', 'currentMeal'];
    saveLayoutConfig(cfg);
    const loaded = loadLayoutConfig();
    expect(loaded.phone).toEqual(cfg.phone);
    expect(loaded.tablet).toEqual(cfg.tablet);
    expect(loaded.desktop).toEqual(cfg.desktop);
  });

  it('drops unknown hidden ids and appends missing widget ids', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      phone: { widgets: ['weather'], hidden: ['bogus', 'tasks'] },
    }));
    const cfg = loadLayoutConfig();
    expect(cfg.phone.hidden).toEqual(['tasks']);
    expect(cfg.phone.widgets).toHaveLength(9);
    expect(cfg.phone.widgets).toContain('morningBriefing');
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, '{not json');
    expect(loadLayoutConfig()).toEqual(cloneDefaultLayout());
  });
});

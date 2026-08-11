// ─── Home Page Layout Config ──────────────────────────────────────────────
// Allows users to show/hide and reorder widgets on the home page.
// Persisted to localStorage. Layouts are configured per layout mode:
// "phone" (single-column vertical stack, portrait <700px), "tablet"
// (2-column bento, portrait 700–1279px) and "desktop" (horizontal filmstrip:
// widgets are shrink-0 columns wider than the viewport, so the dashboard
// scrolls left↔right instead of vertically).

export type WidgetId =
  | "morningBriefing"
  | "weather"
  | "aiQuickAsk"
  | "consuelaSuggestions"
  | "leaderboard"
  | "todayEvents"
  | "schedule"
  | "currentMeal"
  | "tasks";

/** Layout mode bucket. "phone"/"tablet" require portrait aspect + width bands;
 * everything else (landscape, or portrait >= 1280px) is "desktop". */
export type LayoutMode = "phone" | "tablet" | "desktop";

/** Portrait widths below this are phones (700 catches iPad mini 5/6/7 =
 * 768/744/744; no phone is >= 700 CSS px portrait). */
export const PHONE_MAX_WIDTH = 700;

/** Portrait widths below this are tablets (covers iPad Pro 12.9" = 1024,
 * Nest Hub = 1024). */
export const TABLET_MAX_WIDTH = 1280;

/**
 * Pure mode resolution — unit-tested. SSR uses isPortrait=false via the hook.
 */
export function computeLayoutMode(isPortrait: boolean, width: number): LayoutMode {
  if (!isPortrait) return "desktop";
  if (width < PHONE_MAX_WIDTH) return "phone";
  if (width < TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

export interface WidgetDef {
  id: WidgetId;
  label: string;
  emoji: string;
  description: string;
}

export const ALL_WIDGETS: WidgetDef[] = [
  { id: "morningBriefing", label: "Morning Briefing", emoji: "🌅", description: "Today's events, tasks, meals, and what Consuela noticed" },
  { id: "weather",     label: "Weather",       emoji: "⛅", description: "Current weather & atmospheric conditions" },
  { id: "aiQuickAsk",  label: "AI Quick Ask",  emoji: "💬", description: "Quick chat prompt to ask Consuela anything" },
  { id: "consuelaSuggestions", label: "Consuela's Suggestions", emoji: "✨", description: "Proactive alerts Consuela noticed for you" },
  { id: "leaderboard", label: "Leaderboard",    emoji: "🏆", description: "This week's family points race" },
  { id: "todayEvents", label: "Today's Events", emoji: "📅", description: "Upcoming events for the day" },
  { id: "schedule",    label: "Daily Schedule", emoji: "🕐", description: "Routines and reminders" },
  { id: "currentMeal", label: "Current Meal",  emoji: "🍽️", description: "Today's meal plan" },
  { id: "tasks",       label: "Tasks",          emoji: "✅", description: "Pending chores and to-dos" },
];

export interface OrientationLayout {
  /** Ordered list of visible widget ids for one orientation. */
  widgets: WidgetId[];
}

export interface HomeLayoutConfig {
  phone: OrientationLayout;
  tablet: OrientationLayout;
  desktop: OrientationLayout;
}

/**
 * Smart default bento (landscape). The order is chosen so CSS-grid sparse
 * auto-flow tiles every row with no holes while keeping similar cards
 * together: row 1 = briefing + quick ask + leaderboard, row 2 = weather
 * (3-col hero), row 3 = suggestions (2-col) + current meal, row 4 = the
 * three list cards — Daily Schedule + Tasks + Today's Events — side by side.
 * Weather sits after two 1-col widgets so that when the briefing collapses
 * (no content for the day) the only unavoidable empty cell lands at the very
 * top row instead of splitting the pairings below.
 * Portrait keeps the familiar single-column mobile stack.
 */
/** Widgets that span the full tablet row. */
const TABLET_FULL_WIDTH: readonly WidgetId[] = ["morningBriefing", "weather", "consuelaSuggestions"];

/**
 * Reorder a single-column order into a hole-free 2-column tablet order:
 * full-width widgets first (in relative order), then the 1-col widgets,
 * which pair up evenly below. CSS-grid sparse auto-flow leaves a hole when a
 * col-span-2 card follows a col-span-1 card, so the full-width group must
 * lead. Preserves the user's relative order within each group.
 */
export function toTabletOrder(order: WidgetId[]): WidgetId[] {
  const heroes = order.filter((id) => TABLET_FULL_WIDTH.includes(id));
  const rest = order.filter((id) => !TABLET_FULL_WIDTH.includes(id));
  return [...heroes, ...rest];
}

/** Phone (single-column) default order — the source order tablet derives from. */
const PHONE_DEFAULT_WIDGETS: WidgetId[] = [
  "morningBriefing", "weather", "aiQuickAsk", "consuelaSuggestions", "leaderboard", "todayEvents", "schedule", "currentMeal", "tasks",
];

export const DEFAULT_LAYOUT: HomeLayoutConfig = {
  phone: {
    widgets: [...PHONE_DEFAULT_WIDGETS],
  },
  tablet: {
    widgets: toTabletOrder([...PHONE_DEFAULT_WIDGETS]),
  },
  desktop: {
    widgets: ["morningBriefing", "aiQuickAsk", "leaderboard", "weather", "consuelaSuggestions", "currentMeal", "schedule", "tasks", "todayEvents"],
  },
};

/**
 * PRE-MOUNT fallback column spans, applied together with HOME_GRID_FALLBACK
 * for the SSR + first-client-frame render (before the layout hook resolves).
 * Responsive so every width band matches its eventual live grid:
 * <md = 1-col phone stack, md = 2-col tablet, lg = 3-col desktop bento.
 * The live render uses widgetSpanClass() — this map is NOT used post-mount.
 */
export const WIDGET_SPANS: Record<WidgetId, string> = {
  morningBriefing: "col-span-1",
  weather: "md:col-span-2 lg:col-span-3",
  aiQuickAsk: "col-span-1",
  consuelaSuggestions: "md:col-span-2 lg:col-span-2",
  leaderboard: "col-span-1",
  todayEvents: "col-span-1",
  schedule: "col-span-1",
  currentMeal: "col-span-1",
  tasks: "col-span-1",
};

/**
 * Tablet (2-col grid) column spans. Separate from WIDGET_SPANS: the desktop
 * 3-col spans would overflow a 2-col grid.
 */
export const TABLET_COL_SPANS: Record<WidgetId, string> = {
  morningBriefing: "col-span-2",
  weather: "col-span-2",
  aiQuickAsk: "col-span-1",
  consuelaSuggestions: "col-span-2",
  leaderboard: "col-span-1",
  todayEvents: "col-span-1",
  schedule: "col-span-1",
  currentMeal: "col-span-1",
  tasks: "col-span-1",
};

/**
 * Fixed column widths for the landscape filmstrip. Each widget becomes a
 * horizontal flex item wider than the viewport can show at once, so the
 * landscape layout scrolls left↔right (swipe/sideways) instead of
 * vertically. Hero widgets (weather, this-week) get a 2× width; suggestions
 * gets 1.3×; the rest are 1× (~360px) — comfortable for a protruding-icon
 * pastel card on a wide screen.
 */
export const WIDGET_WIDTHS: Record<WidgetId, string> = {
  morningBriefing: "w-[360px]",
  weather: "w-[720px]",
  aiQuickAsk: "w-[360px]",
  consuelaSuggestions: "w-[480px]",
  leaderboard: "w-[360px]",
  todayEvents: "w-[360px]",
  schedule: "w-[360px]",
  currentMeal: "w-[420px]",
  tasks: "w-[360px]",
};

/**
 * Grid classes for the Home layout. Landscape is a horizontal filmstrip
 * (flex + overflow-x-auto + gentle proximity snap): every widget is a
 * shrink-0 column wider than the viewport, so the dashboard scrolls
 * left↔right. Portrait keeps the single-column vertical stack.
 */
export function homeGridClass(mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return "flex gap-6 overflow-x-auto pb-4 pt-6 items-start snap-x snap-proximity";
    case "tablet":
      return "grid grid-cols-2 gap-6 auto-rows-min";
    case "phone":
      return "grid grid-cols-1 gap-6 auto-rows-min";
  }
}

/**
 * Fallback grid classes used before the orientation hook has mounted
 * (SSR + first client frame) — keeps today's breakpoint-driven rendering
 * so there is no layout flash while orientation resolves.
 */
export const HOME_GRID_FALLBACK = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min";

/**
 * Class for one widget in the live orientation. Landscape (filmstrip) returns
 * a shrink-0 snap-start column width; portrait is a single-column stack and
 * returns "" (no span).
 */
export function widgetSpanClass(id: WidgetId, mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return `shrink-0 snap-start ${WIDGET_WIDTHS[id] ?? "w-[360px]"}`;
    case "tablet":
      return TABLET_COL_SPANS[id] ?? "col-span-1";
    case "phone":
      return "";
  }
}

export function homeFooterSpanClass(mode: LayoutMode): string {
  switch (mode) {
    case "desktop":
      return "shrink-0 snap-start w-[720px]";
    case "tablet":
      return "col-span-2";
    case "phone":
      return "";
  }
}

export const LAYOUT_STORAGE_KEY = "consuela-home-layout";

const VALID_IDS = new Set<WidgetId>(ALL_WIDGETS.map((w) => w.id));

export function cloneDefaultLayout(): HomeLayoutConfig {
  return {
    phone: { widgets: [...DEFAULT_LAYOUT.phone.widgets] },
    tablet: { widgets: [...DEFAULT_LAYOUT.tablet.widgets] },
    desktop: { widgets: [...DEFAULT_LAYOUT.desktop.widgets] },
  };
}

/**
 * Validate + self-heal a single orientation's widget list: drop unknown ids
 * and append missing defaults (L6 — the consuela widgets are inserted at
 * their default positions so they don't get buried at the bottom of Home).
 */
function sanitizeLayout(list: unknown): OrientationLayout {
  if (!Array.isArray(list) || list.length === 0) {
    return { widgets: [...DEFAULT_LAYOUT.desktop.widgets] };
  }
  const sanitized = list.filter((id): id is WidgetId => typeof id === "string" && VALID_IDS.has(id as WidgetId));
  const present = new Set(sanitized);
  const missing = ALL_WIDGETS.map((w) => w.id).filter((id) => !present.has(id));
  const widgets = [...sanitized];
  for (const id of DEFAULT_LAYOUT.desktop.widgets) {
    if (!missing.includes(id)) continue;
    if (id === "morningBriefing" || id === "consuelaSuggestions") {
      const idx = id === "morningBriefing" ? 0 : 1;
      widgets.splice(Math.min(idx, widgets.length), 0, id);
    } else {
      widgets.push(id);
    }
  }
  return { widgets };
}

export function loadLayoutConfig(): HomeLayoutConfig {
  if (typeof window === "undefined") return cloneDefaultLayout();
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return cloneDefaultLayout();
    const parsed = JSON.parse(raw);

    // Legacy shape: { widgets: WidgetId[] } — one layout for everything.
    // Migrate it into both orientations so existing users keep their order.
    if (Array.isArray(parsed?.widgets) && parsed.widgets.length > 0) {
      const migrated = sanitizeLayout(parsed.widgets);
      return { portrait: migrated, landscape: { widgets: [...migrated.widgets] } };
    }

    // Current shape: { portrait: { widgets }, landscape: { widgets } }
    if (parsed && typeof parsed === "object") {
      return {
        portrait: sanitizeLayout(parsed.portrait?.widgets),
        landscape: sanitizeLayout(parsed.landscape?.widgets),
      };
    }
    return cloneDefaultLayout();
  } catch {
    return cloneDefaultLayout();
  }
}

export function saveLayoutConfig(config: HomeLayoutConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save layout config", e);
  }
}

/** Move a widget up in the order (lower index = higher on page). */
export function moveWidgetUp(widgets: WidgetId[], id: WidgetId): WidgetId[] {
  const idx = widgets.indexOf(id);
  if (idx <= 0) return widgets;
  const next = [...widgets];
  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
  return next;
}

/** Move a widget down in the order. */
export function moveWidgetDown(widgets: WidgetId[], id: WidgetId): WidgetId[] {
  const idx = widgets.indexOf(id);
  if (idx === -1 || idx >= widgets.length - 1) return widgets;
  const next = [...widgets];
  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  return next;
}

/**
 * Move a widget to a specific index. Used by drag-and-drop.
 * If the widget is not currently visible it is appended at the end of the
 * visible group first, then moved to the target index. If `targetIndex` is
 * out of range it is clamped.
 */
export function moveWidgetTo(widgets: WidgetId[], id: WidgetId, targetIndex: number): WidgetId[] {
  const list = widgets.includes(id) ? [...widgets] : [...widgets, id];
  const fromIndex = list.indexOf(id);
  if (fromIndex === -1) return list;
  const clamped = Math.max(0, Math.min(targetIndex, list.length - 1));
  if (fromIndex === clamped) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(clamped, 0, moved);
  return list;
}

/** Toggle a widget on/off. If turning on, appends to end. */
export function toggleWidget(widgets: WidgetId[], id: WidgetId): WidgetId[] {
  if (widgets.includes(id)) {
    return widgets.filter((w) => w !== id);
  }
  return [...widgets, id];
}

/** Return visible widgets as WidgetDef[] in the user's saved order. */
export function getVisibleWidgets(widgets: WidgetId[]): WidgetDef[] {
  const map = new Map(ALL_WIDGETS.map((w) => [w.id, w]));
  return widgets.map((id) => map.get(id)).filter((w): w is WidgetDef => Boolean(w));
}

/** Return hidden widgets as WidgetDef[] in master order. */
export function getHiddenWidgets(widgets: WidgetId[]): WidgetDef[] {
  const present = new Set(widgets);
  return ALL_WIDGETS.filter((w) => !present.has(w.id));
}

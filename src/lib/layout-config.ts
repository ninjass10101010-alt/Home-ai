// ─── Home Page Layout Config ──────────────────────────────────────────────
// Allows users to show/hide and reorder widgets on the home page.
// Persisted to localStorage. Layouts are configured per device orientation:
// "portrait" (single-column stack, any <1024px portrait viewport) and
// "landscape" (3-column bento, 1024px+ or portrait-width landscape views).

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

/** Device orientation bucket. "portrait" = portrait aspect AND narrow (<1024px). */
export type Orientation = "portrait" | "landscape";

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
  portrait: OrientationLayout;
  landscape: OrientationLayout;
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
export const DEFAULT_LAYOUT: HomeLayoutConfig = {
  landscape: {
    widgets: ["morningBriefing", "aiQuickAsk", "leaderboard", "weather", "consuelaSuggestions", "currentMeal", "schedule", "tasks", "todayEvents"],
  },
  portrait: {
    widgets: ["morningBriefing", "weather", "aiQuickAsk", "consuelaSuggestions", "leaderboard", "todayEvents", "schedule", "currentMeal", "tasks"],
  },
};

/** Desktop bento column spans for each widget. Portrait uses 1 col (grid-cols-1). */
export const WIDGET_SPANS: Record<WidgetId, string> = {
  morningBriefing: "col-span-1",
  weather: "col-span-3",
  aiQuickAsk: "col-span-1",
  consuelaSuggestions: "col-span-2",
  leaderboard: "col-span-1",
  todayEvents: "col-span-1",
  schedule: "col-span-1",
  currentMeal: "col-span-1",
  tasks: "col-span-1",
};

/**
 * Grid classes for the Home bento. The bento must follow the live
 * `orientation` value, NOT the CSS `lg:` breakpoint: on a narrow landscape
 * viewport (<1024px wide, e.g. a phone held sideways) the breakpoint never
 * matches, so only the orientation hook can flip the visuals.
 */
export function homeGridClass(orientation: Orientation): string {
  return orientation === "landscape"
    ? "grid grid-cols-3 gap-6 auto-rows-min"
    : "grid grid-cols-1 gap-6 auto-rows-min";
}

/**
 * Fallback grid classes used before the orientation hook has mounted
 * (SSR + first client frame) — keeps today's breakpoint-driven rendering
 * so there is no layout flash while orientation resolves.
 */
export const HOME_GRID_FALLBACK = "grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-min";

/**
 * Column span for one widget in the live orientation. Spans only exist in
 * landscape; portrait is a single-column stack and must not span.
 */
export function widgetSpanClass(id: WidgetId, orientation: Orientation): string {
  if (orientation !== "landscape") return "";
  return WIDGET_SPANS[id] ?? "col-span-1";
}

/** Full-width (3-col) footer row for the bento; hidden in portrait. */
export function homeFooterSpanClass(orientation: Orientation): string {
  return orientation === "landscape" ? "col-span-3" : "";
}

export const LAYOUT_STORAGE_KEY = "consuela-home-layout";

const VALID_IDS = new Set<WidgetId>(ALL_WIDGETS.map((w) => w.id));

export function cloneDefaultLayout(): HomeLayoutConfig {
  return {
    portrait: { widgets: [...DEFAULT_LAYOUT.portrait.widgets] },
    landscape: { widgets: [...DEFAULT_LAYOUT.landscape.widgets] },
  };
}

/**
 * Validate + self-heal a single orientation's widget list: drop unknown ids
 * and append missing defaults (L6 — the consuela widgets are inserted at
 * their default positions so they don't get buried at the bottom of Home).
 */
function sanitizeLayout(list: unknown): OrientationLayout {
  if (!Array.isArray(list) || list.length === 0) {
    return { widgets: [...DEFAULT_LAYOUT.landscape.widgets] };
  }
  const sanitized = list.filter((id): id is WidgetId => typeof id === "string" && VALID_IDS.has(id as WidgetId));
  const present = new Set(sanitized);
  const missing = ALL_WIDGETS.map((w) => w.id).filter((id) => !present.has(id));
  const widgets = [...sanitized];
  for (const id of DEFAULT_LAYOUT.landscape.widgets) {
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

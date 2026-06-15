// ─── Home Page Layout Config ──────────────────────────────────────────────
// Allows users to show/hide and reorder widgets on the home page.
// Persisted to localStorage.

export type WidgetId =
  | "weather"
  | "aiQuickAsk"
  | "leaderboard"
  | "todayEvents"
  | "schedule"
  | "currentMeal"
  | "tasks";

export interface WidgetDef {
  id: WidgetId;
  label: string;
  emoji: string;
  description: string;
}

export const ALL_WIDGETS: WidgetDef[] = [
  { id: "weather",     label: "Weather",       emoji: "⛅", description: "Current weather & atmospheric conditions" },
  { id: "aiQuickAsk",  label: "AI Quick Ask",  emoji: "💬", description: "Quick chat prompt to ask Consuela anything" },
  { id: "leaderboard", label: "Leaderboard",    emoji: "🏆", description: "This week's family points race" },
  { id: "todayEvents", label: "Today's Events", emoji: "📅", description: "Upcoming events for the day" },
  { id: "schedule",    label: "Daily Schedule", emoji: "🕐", description: "Routines and reminders" },
  { id: "currentMeal", label: "Current Meal",  emoji: "🍽️", description: "Today's meal plan" },
  { id: "tasks",       label: "Tasks",          emoji: "✅", description: "Pending chores and to-dos" },
];

export interface HomeLayoutConfig {
  /** Ordered list of visible widget ids. Only ids in this array are shown. */
  widgets: WidgetId[];
}

export const DEFAULT_LAYOUT: HomeLayoutConfig = {
  widgets: ["weather", "aiQuickAsk", "leaderboard", "todayEvents", "schedule", "currentMeal", "tasks"],
};

export const LAYOUT_STORAGE_KEY = "consuela-home-layout";

const VALID_IDS = new Set<WidgetId>(ALL_WIDGETS.map((w) => w.id));

export function loadLayoutConfig(): HomeLayoutConfig {
  if (typeof window === "undefined") return { ...DEFAULT_LAYOUT, widgets: [...DEFAULT_LAYOUT.widgets] };
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT, widgets: [...DEFAULT_LAYOUT.widgets] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.widgets) && parsed.widgets.length > 0) {
      const sanitized = parsed.widgets.filter((id: unknown): id is WidgetId => typeof id === "string" && VALID_IDS.has(id as WidgetId));
      const present = new Set(sanitized);
      const missing = DEFAULT_LAYOUT.widgets.filter((id) => !present.has(id));
      return { widgets: [...sanitized, ...missing] };
    }
    return { ...DEFAULT_LAYOUT, widgets: [...DEFAULT_LAYOUT.widgets] };
  } catch {
    return { ...DEFAULT_LAYOUT, widgets: [...DEFAULT_LAYOUT.widgets] };
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

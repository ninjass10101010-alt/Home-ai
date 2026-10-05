// @vitest-environment jsdom
// The kid's "✅ Done today (n)" card (KidHome.tsx:1163) counted completions by
// comparing UTC date parts on both sides:
//
//     t.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)
//
// That is self-consistent but semantically wrong: the card means "completed
// TODAY", and "today" is a LOCAL day. In America/Detroit the UTC date rolls over
// at 20:00, so from 8pm onward a chore the kid finished at 3pm stops counting —
// the card empties as the evening goes on, and the points total drops with it.
// The reverse is equally wrong: a chore finished at 9pm Sunday would appear on
// Monday's card.
//
// Harness mirrors tests/unit/kid-home-race-line.test.tsx: createRoot + act, with
// task-utils and local-date left REAL so the production day math runs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const mockAuth = vi.hoisted(() => ({
  currentUser: { name: "Caspian", role: "child", age: 10, emoji: "🧒", color: "green" } as any,
  logout: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/hooks/useWallMode", () => ({ useWallMode: () => ({ wall: false, mounted: true }) }));
vi.mock("@/hooks/useDashboardMode", () => ({
  useDashboardMode: () => ({
    mode: "kid", isBedtime: false, isWeekend: false,
    currentHour: 15, currentDay: 1, previousMode: null,
  }),
}));
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [{ id: 1, name: "Caspian", fullName: "Caspian Garcia", role: "child", emoji: "🧒", color: "green" }],
    selectMembersDetailed: () => [{ name: "Caspian Garcia", color: "green", emoji: "🧒" }],
    selectTodaysEvents: () => [],
    selectMeals: async () => [],
  },
}));
vi.mock("@/components/integrations/SpotifyWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/AllowanceWidget", () => ({ default: () => null }));
vi.mock("@/components/integrations/LearningWidget", () => ({ default: () => null }));
vi.mock("@/components/ui/EmergencyButton", () => ({ default: () => null }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));
vi.mock("@/components/leaderboard/WeeklyWinModal", () => ({ default: () => null }));
vi.mock("@/hooks/useAtmosphericTheme", () => ({
  AtmosphericProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAtmosphericTheme: () => ({
    theme: {}, filterId: "atmos", accentRgb: "0,0,0",
    colors: { glow: "", gradientStop: "", accentColor: "" },
  }),
}));

import KidHome from "@/modes/kid/KidHome";
import { localWeekStartISO } from "@/lib/local-date";
import { TASKS_STORAGE_KEY, WEEK_DATA_KEY } from "@/lib/task-utils";

const DETROIT = "America/Detroit";

/** Mon 2026-09-28 15:00 EDT — the chore is done before the evening roll-over. */
const AFTERNOON = "2026-09-28T15:00:00-04:00";
/** Mon 2026-09-28 21:00 EDT === Tue 01:00Z — UTC has already moved on. */
const EVENING = "2026-09-28T21:00:00-04:00";

function seedTasks(completedAt: string) {
  localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify([
    {
      id: 1,
      title: "Take out trash",
      assignee: "Caspian",
      assigneeEmoji: "🧒",
      due: "2026-09-28",
      points: 5,
      recurring: null,
      category: "chores",
      completed: true,
      completedBy: "Caspian",
      completedAt,
      // Seed the week from the test's own date — calling this with the real
      // clock (before fake timers are installed) crosses week boundaries and
      // broke this suite on 2026-10-05.
      completedInWeek: localWeekStartISO(new Date(completedAt)),
      priority: "medium",
    },
  ]));
  localStorage.setItem(WEEK_DATA_KEY, JSON.stringify({ points: {}, history: [], archives: [] }));
}

function renderNow(at: string): HTMLElement {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(<KidHome /> as ReactElement));
  return el;
}

beforeEach(() => {
  process.env.TZ = DETROIT;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  localStorage.clear();
  process.env.TZ = DETROIT;
});

describe("kid 'Done today' card counts the LOCAL day", () => {
  it("still counts an afternoon chore when the kid looks at the card at 9pm", () => {
    // Mon 15:00 local => completedAt 2026-09-28T19:00Z
    seedTasks("2026-09-28T19:00:00.000Z");
    const el = renderNow(EVENING);
    expect(el.textContent, "the 3pm chore must not vanish at 9pm").toContain("Done today (1)");
  });

  it("counts it in the afternoon too", () => {
    seedTasks("2026-09-28T19:00:00.000Z");
    const el = renderNow(AFTERNOON);
    expect(el.textContent).toContain("Done today (1)");
  });

  it("does not count yesterday's chore as today's", () => {
    // Sun 2026-09-27 18:00 local === Sun 22:00Z
    seedTasks("2026-09-27T22:00:00.000Z");
    const el = renderNow(AFTERNOON);
    expect(el.textContent).not.toContain("Done today (1)");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

vi.mock("@/db", () => ({
  db: {
    refreshMembersCache: vi.fn(async () => {}),
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Bailey", fullName: "Bailey", role: "child", emoji: "👧", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Bailey", fullName: "Bailey", role: "child", emoji: "👧", color: "mint" },
    ],
  },
}));

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function thisMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

function clickTile(el: HTMLElement, name: string) {
  const btn = [...el.querySelectorAll("button.member-tile")].find((b) => (b.textContent || "").includes(name));
  expect(btn).toBeTruthy();
  (btn as HTMLButtonElement).click();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
});

describe("filter-aware stat tiles + scoped empty copy", () => {
  it("tiles follow the member filter (Bailey's pending + earned)", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 1, title: "Jasmine's chore", assignee: "Jasmine", assigneeEmoji: "👧", due: TODAY, points: 9, recurring: null, category: "Chores", completed: false, priority: "low" },
      { id: 2, title: "Bailey's chore", assignee: "Bailey", assigneeEmoji: "👧", due: TODAY, points: 7, recurring: null, category: "Chores", completed: false, priority: "low" },
      { id: 3, title: "Bailey finished one", assignee: "Bailey", assigneeEmoji: "👧", due: TODAY, points: 12, recurring: null, category: "Chores", completed: true, completedBy: "Bailey", completedAt: new Date().toISOString(), completedInWeek: thisMondayISO(), priority: "medium" },
    ]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: thisMondayISO(), points: { Rebecca: 15, Bailey: 12 }, history: [], streak: {}, lastActive: {} }));

    const el = await renderAsync(<TasksPage />);
    await settle();

    const tileText = () => [...el.querySelectorAll(".grid.gap-3.sm\\:grid-cols-3 > *")].map((t) => (t.textContent || "")).join("|");
    expect(tileText()).toContain("27"); // Earned: 15 + 12 family total
    expect(tileText()).toContain("2"); // Pending family-wide

    clickTile(el, "Bailey");
    await settle();

    const text = tileText();
    expect(text).toContain("12"); // Earned: Bailey only
    expect(text).not.toContain("27");
  });

  it("filtered empty state names the member", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 1, title: "Jasmine's chore", assignee: "Jasmine", assigneeEmoji: "👧", due: TODAY, points: 9, recurring: null, category: "Chores", completed: false, priority: "low" },
    ]));

    const el = await renderAsync(<TasksPage />);
    await settle();
    clickTile(el, "Bailey");
    await settle();

    expect(el.textContent).toContain("Nothing pending for Bailey");
  });

  it("row entrance stagger caps at 8", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i, title: `Chore ${i}`, assignee: "Jasmine", assigneeEmoji: "👧", due: TODAY, points: 5, recurring: null, category: "Chores", completed: false, priority: "low" as const,
    }));
    localStorage.setItem("consuela-tasks", JSON.stringify(many));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const rows = el.querySelectorAll(".schedule-row");
    const last = rows[rows.length - 1] as HTMLElement;
    expect(last.style.animationDelay).toBe("0.4s"); // min(9, 8) * 0.05
  });
});

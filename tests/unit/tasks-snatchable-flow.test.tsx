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
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 4, name: "Rocco", fullName: "Rocco", role: "pet", emoji: "🐶", color: "amber" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 4, name: "Rocco", fullName: "Rocco", role: "pet", emoji: "🐶", color: "amber" },
    ],
  },
}));

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const YESTERDAY = isoDaysAgo(1);
const TOMORROW = isoDaysAgo(-1);
const TODAY = isoDaysAgo(0);

function seedSnatchTasks() {
  localStorage.setItem("consuela-tasks", JSON.stringify([
    { id: 10, title: "Wipe the bathroom counters", assignee: "Emily", assigneeEmoji: "👧", due: YESTERDAY, points: 12, recurring: null, category: "Chores", completed: false, priority: "high", stealable: true },
    { id: 11, title: "Water the plants", assignee: "Jasmine", assigneeEmoji: "👧", due: TOMORROW, points: 5, recurring: null, category: "Chores", completed: false, priority: "low", stealable: true },
    { id: 12, title: "Fold the laundry", assignee: "Jasmine", assigneeEmoji: "👧", due: TODAY, points: 8, recurring: null, category: "Chores", completed: false, priority: "low" },
  ]));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 100) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

function stubGuestFetches() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
});

describe("stealable tasks surface", () => {
  it("'Up for grabs' shows late stealable tasks, hides on-time stealable ones, and marks them 'was due'", async () => {
    stubGuestFetches();
    seedSnatchTasks();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const upBtn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Up for grabs"));
    expect(upBtn).toBeTruthy();
    upBtn!.click();
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("Wipe the bathroom counters");
    expect(text).toContain("was due");
    expect(text).not.toContain("Water the plants");
    expect(text).not.toContain("Fold the laundry");
  });

  it("tapping a late stealable row opens the PIN modal with a 'Claim for' select", async () => {
    stubGuestFetches();
    seedSnatchTasks();
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = [...el.querySelectorAll("[role='button']")].find((b) => (b.getAttribute("aria-label") || "").includes("Wipe the bathroom counters"));
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
    await settle();

    // Modal portals to document.body
    expect(document.body.textContent).toMatch(/Enter your PIN/);
    expect(document.body.textContent).toContain("Claim for");
  });

  it("a normal assigned task does NOT get the 'Claim for' select", async () => {
    stubGuestFetches();
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 20, title: "Fold the laundry", assignee: "Jasmine", assigneeEmoji: "👧", due: TODAY, points: 8, recurring: null, category: "Chores", completed: false, priority: "low" },
    ]));
    const el = await renderAsync(<TasksPage />);
    await settle();

    const row = [...el.querySelectorAll("[role='button']")].find((b) => (b.getAttribute("aria-label") || "").includes("Fold the laundry"));
    (row as HTMLElement).click();
    await settle();

    expect(document.body.textContent).toMatch(/Enter your PIN/);
    expect(document.body.textContent).not.toContain("Claim for");
  });
});

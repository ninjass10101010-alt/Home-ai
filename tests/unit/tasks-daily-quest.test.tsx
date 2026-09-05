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
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
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

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = { name: "Rebecca", role: "parent", emoji: "👩" };
  mockAuth.isLoggedIn = true;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, snapshot: null }) })));
});

describe("Daily Quests", () => {
  it("'Do it' opens the PIN flow for the quest instead of duplicating the task", async () => {
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 42, title: "Take out the trash", assignee: "Rebecca", assigneeEmoji: "👩", due: new Date().toISOString().split("T")[0], points: 10, recurring: null, category: "Chores", completed: false, priority: "medium" },
    ]));

    const el = await renderAsync(<TasksPage />);
    await settle();

    // Leaderboard tab is where the quest card lives.
    const lb = [...el.querySelectorAll('button, [role="radio"]')].find((b) => (b.textContent || "").trim() === "Leaderboard");
    (lb as HTMLButtonElement)?.click();
    await settle();

    expect(el.textContent).toContain("Today's Quests");
    const countBefore = (el.textContent || "").split("Take out the trash").length - 1;

    const doBtn = [...el.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Do "));
    expect(doBtn).toBeTruthy();
    (doBtn as HTMLButtonElement).click();
    await settle();

    const countAfter = (el.textContent || "").split("Take out the trash").length - 1;
    expect(countAfter).toBe(countBefore); // no duplicate was added
    expect(document.body.textContent).toMatch(/Enter your PIN/); // real completion flow opened
  });
});

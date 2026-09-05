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
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
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

function thisMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clickLeaderboard(el: HTMLElement) {
  const lb = [...el.querySelectorAll('button, [role="radio"]')].find((b) => (b.textContent || "").trim() === "Leaderboard");
  (lb as HTMLButtonElement).click();
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
});

describe("champion card honesty", () => {
  it("zero-point week shows an up-for-grabs crown, no ring, no Share", async () => {
    const el = await renderAsync(<TasksPage />);
    await settle();
    clickLeaderboard(el);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("The crown is up for grabs");
    expect(text).not.toContain("Champion share");
    expect(el.querySelector("[aria-label^='Share']")).toBeNull();
  });

  it("a real week shows the champion card with the 44px Share button", async () => {
    localStorage.setItem("consuela-week-data", JSON.stringify({
      weekStart: thisMondayISO(),
      points: { Rebecca: 15, Emily: 5 },
      streak: {}, lastActive: {},
      history: [],
    }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    clickLeaderboard(el);
    await settle();

    const text = el.textContent || "";
    expect(text).toContain("This week's champion");
    expect(text).toContain("Champion share");
    const share = el.querySelector("[aria-label^='Share']");
    expect(share).toBeTruthy();
    expect(share!.getAttribute("aria-label")).toContain("Rebecca");
  });
});

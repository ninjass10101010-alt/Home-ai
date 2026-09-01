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

// Guest = not signed in (exactly the incognito scenario)
const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// The db module is heavy (module-level PB hydrate) — mock the surface the page uses.
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
    ],
  },
}));

// Sessioned reads 401 for guests — the exact live condition that made tasks
// silently "vanish" for signed-out browsers.
function stubFetch(statuses: { sync: number; gateway: number }) {
  const fetchMock = vi.fn(async () => ({
    ok: statuses.sync === 200 && statuses.gateway === 200,
    status: statuses.sync,
    json: async () => {
      if (statuses.sync === 200) return { ok: true, snapshot: null };
      return { error: "unauthorized" };
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 100) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("Tasks page guest sync-unavailable state", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  it("shows the sign-in hint (not the plain all-caught-up state) when reads 401 and no local tasks", async () => {
    stubFetch({ sync: 401, gateway: 401 });
    const el = await renderAsync(<TasksPage />);
    await settle();
    const text = el.textContent || "";
    expect(text).not.toContain("All caught up");
    expect(text).toContain("Sign in");
  });

  it("keeps the normal all-caught-up state when a signed-in session has genuinely no tasks", async () => {
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent", emoji: "👩" };
    mockAuth.isLoggedIn = true;
    stubFetch({ sync: 200, gateway: 200 });
    const el = await renderAsync(<TasksPage />);
    await settle();
    const text = el.textContent || "";
    expect(text).toContain("All caught up");
    expect(text).not.toContain("Sign in to see tasks");
  });

  it("shows local tasks without the sign-in hint when they exist despite 401s", async () => {
    stubFetch({ sync: 401, gateway: 401 });
    localStorage.setItem("consuela-tasks", JSON.stringify([
      { id: 42, title: "Guest-visible local chore", assignee: "Jasmine", points: 5, priority: "low", completed: false, due: "2026-08-31", category: "Chores" },
    ]));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const text = el.textContent || "";
    expect(text).toContain("Guest-visible local chore");
    expect(text).not.toContain("Sign in to see tasks");
  });
});

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

const PHOTO = "data:image/webp;base64,UklGRlkyAABXRUJQVlA4WAoAAAAQ";

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: (globalThis as any).__EMILY_EMOJI, color: "rose" },
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: (globalThis as any).__EMILY_EMOJI, color: "rose" },
    ],
  },
}));

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, snapshot: null }) })));
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  return el;
}

async function settle(ms = 150) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("Tasks page member avatars", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    (globalThis as any).__EMILY_EMOJI = PHOTO;
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  it("renders a photo avatar (img) on the member filter tile, not a 👤 placeholder", async () => {
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();
    const tiles = el.querySelectorAll(".member-tile");
    expect(tiles.length).toBeGreaterThan(0);
    const img = el.querySelector(".member-tile img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    expect(el.querySelector(".member-tile")!.textContent).not.toContain("👤");
  });

  it("still renders plain emoji members as emoji text", async () => {
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("👩");
  });
});

// 2026-09-23 review — roster-first TASK ROWS: task rows may carry
// assigneeEmoji "👤" (the persistedTaskEmoji write gate collapses photo
// avatars at every PB boundary), so rendering the stored field as the
// member's avatar showed a silhouette for photo members on exactly the rows
// the family looks at. Rows now resolve the avatar from the live roster
// first (members.emoji holds the real photo), keeping the stored glyph only
// as the fallback.
describe("Tasks page task-row avatars (roster-first)", () => {
  const ROW_TITLE = "Do the dishes";

  function rowEl(root: HTMLElement, title: string): Element | null {
    // Walk up from any element containing the exact title text to a row-like
    // ancestor that would carry the row's Avatar.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent === title) {
        let el: Element | null = node.parentElement;
        while (el && el !== root) {
          if (el.querySelector("img, [data-avatar], .avatar") || el.className.toString().includes("liquid-glass")) return el;
          el = el.parentElement;
        }
        return node.parentElement;
      }
    }
    return null;
  }

  function seededTask(over: Record<string, unknown> = {}) {
    return {
      id: 77, title: ROW_TITLE, assignee: "Emily", assigneeEmoji: "👤",
      due: "2026-09-25", points: 5, recurring: null, category: "Chores",
      completed: false, priority: "low", ...over,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    (globalThis as any).__EMILY_EMOJI = PHOTO;
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  it("a pending row for a photo member renders the roster photo, not the 👤 fallback", async () => {
    stubFetch();
    localStorage.setItem("consuela-tasks", JSON.stringify([seededTask()]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const row = rowEl(el, ROW_TITLE);
    expect(row).toBeTruthy();
    const img = row!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
  });

  it("the parent Needs-approval queue renders the roster photo for the tapping kid", async () => {
    stubFetch();
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    localStorage.setItem("consuela-tasks", JSON.stringify([seededTask({
      completed: true, completedBy: "Emily", completedAt: new Date().toISOString(), completedInWeek: "2026-09-21",
      pendingApproval: { byName: "Emily", at: new Date().toISOString(), points: 5 },
    })]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("Needs approval");
    const row = rowEl(el, ROW_TITLE);
    expect(row).toBeTruthy();
    const img = row!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
  });

  it("non-member assignees (Open) keep their stored glyph — no roster hijack", async () => {
    stubFetch();
    localStorage.setItem("consuela-tasks", JSON.stringify([seededTask({ assignee: "Open", assigneeEmoji: "🤝", universal: true })]));
    localStorage.setItem("consuela-week-data", JSON.stringify({ weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] }));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const row = rowEl(el, ROW_TITLE);
    expect(row).toBeTruthy();
    expect(row!.querySelector("img")).toBeNull();
    // The Open board renders its own 🫳 grab glyph — no roster hijack, no
    // silhouette where a real member photo should be.
    expect(row!.textContent).toContain("🫳");
  });
});

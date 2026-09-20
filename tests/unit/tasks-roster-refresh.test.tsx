// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const PHOTO = "data:image/webp;base64,UklGRkIZAABXRUJQVlA4WAoAAAAQREBEQA==";

const rosterMock = vi.hoisted(() => ({
  members: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: () => rosterMock.members.map((m) => ({ ...m })),
    selectMembersFallback: () => rosterMock.members.map((m) => ({ ...m })),
  },
}));

let activeRoot: Root | null = null;

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

async function settle(ms = 120) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

let lastHermesBody: any = null;
function stubFetch(plannerResponse?: any) {
  lastHermesBody = null;
  vi.stubGlobal("fetch", vi.fn(async (input: any, opts?: any) => {
    if (String(input).includes("/api/hermes/chat")) {
      lastHermesBody = opts?.body ? JSON.parse(opts.body) : null;
      return { ok: true, status: 200, json: async () => plannerResponse ?? { ok: false, reason: "provider_unavailable" } };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: null }) };
  }));
}

describe("Tasks page live roster (consuela-members-updated)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
    rosterMock.members = [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "rose" },
    ];
    mockAuth.currentUser = null;
    mockAuth.isLoggedIn = false;
  });

  afterEach(() => {
    act(() => { activeRoot?.unmount(); });
    activeRoot = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("member tiles re-read the roster after consuela-members-updated fires (photo swaps in)", async () => {
    stubFetch();
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.querySelectorAll(".member-tile").length).toBeGreaterThan(0);
    // Pre-event: Emily is a plain emoji, no photo <img> in the tiles.
    expect(el.querySelector(".member-tile img")).toBeNull();

    // The roster refreshes (e.g. 60s CacheRefresher pull): Emily's emoji is now a photo.
    rosterMock.members = rosterMock.members.map((m) =>
      m.name === "Emily" ? { ...m, emoji: PHOTO } : m
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });
    await settle();

    const img = el.querySelector(".member-tile img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
  });

  it("AI suggestions post a planner intent, render photo assignees through Avatar, and drop unknown assignees", async () => {
    stubFetch({
      ok: true,
      intent: "task_ideas",
      result: {
        actions: [
          { type: "task", title: "Walk the dog", assignee: "Emily", points: 5 },
          { type: "task", title: "Phantom kid chore", assignee: "Nobody Real", points: 5 },
        ],
      },
    });
    rosterMock.members = [
      { id: 1, name: "Rebecca", fullName: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet" },
      { id: 3, name: "Emily", fullName: "Emily", role: "child", emoji: PHOTO, color: "rose" },
    ];
    const el = await renderAsync(<TasksPage />);
    await settle();

    // Parent-only generator: sign in and use the quiet entry line.
    mockAuth.currentUser = { name: "Rebecca (Mom)", role: "parent" };
    mockAuth.isLoggedIn = true;
    const el2 = await renderAsync(<TasksPage />);
    await settle();

    await act(async () => {
      const btn = Array.from(el2.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Get chore ideas"));
      expect(btn).toBeTruthy();
      btn!.click();
    });
    await settle(300);

    // Real request body: planner intent only — no handcrafted prompt, no Caspian.
    expect(lastHermesBody).toEqual({ agent: "planner", intent: "task_ideas" });
    expect(lastHermesBody.message).toBeUndefined();

    const card = Array.from(el2.querySelectorAll("div")).find((n) => n.textContent?.includes("Walk the dog"));
    expect(card).toBeTruthy();
    // Off-roster assignee is dropped outright (never defaulted onto a named kid).
    expect(el2.textContent).not.toContain("Phantom kid chore");
    // Photo assignee must render as a real <img> (Avatar → SigmaImage)…
    const img = card!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PHOTO);
    // …and the base64 payload must never leak as raw text into the DOM.
    expect(el.textContent).not.toContain("data:image");
  });
});

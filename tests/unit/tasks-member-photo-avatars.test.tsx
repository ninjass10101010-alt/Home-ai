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

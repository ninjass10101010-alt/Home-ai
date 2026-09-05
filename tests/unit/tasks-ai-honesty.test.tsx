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
    ],
    selectMembersFallback: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Jasmine", fullName: "Jasmine", role: "child", emoji: "👧", color: "rose" },
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
  mockAuth.currentUser = null;
  mockAuth.isLoggedIn = false;
});

describe("Consuela suggests honesty", () => {
  it("an unparsable Hermes reply keeps the honest empty state (no invented chores) + honest toast", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      if (String(url).includes("/api/hermes/chat")) {
        return { ok: true, status: 200, json: async () => ({ content: "sorry I can't help with that format" }) } as any;
      }
      return { ok: false, status: 401, json: async () => ({}) } as any;
    }));

    const el = await renderAsync(<TasksPage />);
    await settle();

    const genBtn = [...el.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Generate");
    expect(genBtn).toBeTruthy();
    (genBtn as HTMLButtonElement).click();
    await settle(200);

    const text = document.body.textContent || "";
    expect(text).toContain("No suggestions yet");
    expect(text).not.toContain("Make your bed"); // the old hardcoded fallback
    expect(text).toContain("couldn't come up with ideas");
  });

  it("the sync button is labeled honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)));
    const el = await renderAsync(<TasksPage />);
    await settle();
    const btns = [...el.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(btns).toContain("Sync Google Tasks");
    expect(btns).not.toContain("Google");
  });
});

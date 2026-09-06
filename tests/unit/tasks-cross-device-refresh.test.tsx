// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import TasksPage from "@/app/tasks/page";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockAuth = vi.hoisted(() => ({ currentUser: null as null | any, isLoggedIn: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockAuth }));
vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

// Any db access not explicitly needed returns a harmless async null;
// the behavior under test is the page's refresh listener, not the server.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "selectMembers" || prop === "selectMembersFallback") return () => [];
        return async () => null;
      },
    }
  ),
}));

const server = vi.hoisted(() => ({ snapshot: null as any }));

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
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("Tasks page cross-device refresh", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        if (String(input).includes("/api/tasks/sync")) {
          return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: server.snapshot }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );
    server.snapshot = {
      tasks: [{ id: 11, title: "Tablet Chore", assignee: "All", completed: false }],
      weekData: null,
      rewards: [],
      penalties: [],
    };
    mockAuth.currentUser = null;
    // Signed out keeps the "All" member filter so every task is visible.
    // (Signed in flips the filter to "My Tasks".) The snapshot restore
    // itself does not depend on login state.
    mockAuth.isLoggedIn = false;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (activeRoot) {
      await act(async () => {
        activeRoot!.unmount();
      });
      activeRoot = null;
    }
  });

  it("merges another device's task when consuela-data-refreshed fires", async () => {
    const el = await renderAsync(<TasksPage />);
    await settle();
    expect(el.textContent).toContain("Tablet Chore");
    expect(el.textContent).not.toContain("Phone Chore");

    // Another device adds a task; the server snapshot now has it.
    server.snapshot = {
      tasks: [
        { id: 11, title: "Tablet Chore", assignee: "All", completed: false },
        { id: 22, title: "Phone Chore", assignee: "All", completed: false },
      ],
      weekData: null,
      rewards: [],
      penalties: [],
    };
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });
    await settle();

    expect(el.textContent).toContain("Phone Chore");
  });
});

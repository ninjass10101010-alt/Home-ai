// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

const memberCache = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Task 9 — login must go through POST /api/auth/login and persist the
// sanitized server member WITHOUT any pin field in localStorage.
vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => []),
    selectMembersDetailed: vi.fn(() => memberCache.value),
    refreshCaches: vi.fn(async () => {}),
  },
}));

import { AuthProvider, normalizeAuthRole, useAuth } from "@/hooks/useAuth";

const ctxRef: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const ctx = useAuth();
  useEffect(() => {
    ctxRef.current = ctx;
  });
  return null;
}

const mountedRoots: Root[] = [];

function mount(ui: ReactElement): { element: HTMLElement; root: Root } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return { element, root };
}

function unmountRoot(root: Root) {
  const index = mountedRoots.indexOf(root);
  if (index >= 0) mountedRoots.splice(index, 1);
  act(() => root.unmount());
}

function renderProvider() {
  return mount(<AuthProvider><Probe /></AuthProvider> as ReactElement);
}

const SANITIZED_MEMBER = {
  id: 7,
  name: "Caspian",
  role: "child",
  emoji: "🧒",
  color: "green",
  avatarSize: "md",
  glow: false,
};

describe("useAuth.login — server-side authentication", () => {
  beforeEach(() => {
    localStorage.clear();
    memberCache.value = [];
    ctxRef.current = null;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      unmountRoot(mountedRoots[mountedRoots.length - 1]);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/auth/login and persists the identity WITHOUT a pin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, member: SANITIZED_MEMBER }),
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();
    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await ctxRef.current!.login("Caspian", "1010");
    });

    expect(outcome?.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ memberName: "Caspian", pin: "1010" });

    const stored = JSON.parse(localStorage.getItem("consuela-auth-user")!);
    expect("pin" in stored).toBe(false);
    expect(stored).toEqual({
      id: 7,
      name: "Caspian",
      role: "child",
      emoji: "🧒",
      color: "green",
      avatarSize: "md",
      glow: false,
    });
    expect(ctxRef.current!.currentUser).toMatchObject({ name: "Caspian", role: "child" });
    expect(ctxRef.current!.isLoggedIn).toBe(true);
    expect(ctxRef.current!.currentUser && "pin" in ctxRef.current!.currentUser).toBe(false);

    vi.unstubAllGlobals();
  });

  it("returns Incorrect PIN for a 401 and stores nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Invalid PIN" }),
      { status: 401 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();
    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await ctxRef.current!.login("Caspian", "0000");
    });

    expect(outcome).toEqual({ success: false, error: "Incorrect PIN" });
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
    expect(ctxRef.current!.isLoggedIn).toBe(false);

    vi.unstubAllGlobals();
  });

  it("returns a generic retry error for a 500 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    renderProvider();

    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await ctxRef.current!.login("Caspian", "1010");
    });

    expect(outcome).toEqual({ success: false, error: "Sign-in failed. Try again." });
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
  });

  it("returns honest offline copy when the login request cannot reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderProvider();

    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await ctxRef.current!.login("Caspian", "1010");
    });

    expect(outcome).toEqual({
      success: false,
      error: "Couldn't reach Consuela — check the connection and try again.",
    });
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
  });

  // MF-1 — sign-out must also POST /api/auth/logout so the httpOnly
  // consuela_session cookie dies; clearing localStorage alone left the
  // server session alive (≤7d) on shared devices.
  it("logout POSTs /api/auth/logout to clear the httpOnly session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true }),
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian" }));
    renderProvider();
    act(() => {
      ctxRef.current!.logout();
    });

    const call = fetchMock.mock.calls.find(([u]: unknown[]) => String(u).includes("/api/auth/logout"));
    expect(call).toBeTruthy();
    expect((call as any[])[1].method).toBe("POST");
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
    expect(ctxRef.current!.isLoggedIn).toBe(false);

    vi.unstubAllGlobals();
  });

  it("marks auth hydrated only after initial identity reconciliation", () => {
    memberCache.value = [{ name: "Caspian", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: "child" }));
    const states: boolean[] = [];
    const identities: string[] = [];
    function HydrationProbe() {
      const { hydrated, currentUser } = useAuth();
      states.push(hydrated);
      identities.push(currentUser?.name ?? "");
      return null;
    }

    mount(
      <AuthProvider>
        <HydrationProbe />
      </AuthProvider> as ReactElement,
    );

    expect(states[0]).toBe(false);
    expect(states[states.length - 1]).toBe(true);
    expect(identities[identities.length - 1]).toBe("Caspian");
  });

  it("completes hydration when localStorage getItem and removeItem throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("getItem unavailable");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("removeItem unavailable");
    });
    const states: boolean[] = [];
    function HydrationProbe() {
      states.push(useAuth().hydrated);
      return null;
    }

    mount(<AuthProvider><HydrationProbe /></AuthProvider> as ReactElement);

    expect(states[0]).toBe(false);
    expect(states[states.length - 1]).toBe(true);
  });

  it("normalizes the hydrated role from the reconciled roster", () => {
    memberCache.value = [{ name: "Caspian", role: "parent", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: "child" }));
    renderProvider();

    expect(ctxRef.current?.currentUser?.role).toBe("parent");
  });

  it("normalizes trimmed case-insensitive auth roles", () => {
    expect(normalizeAuthRole(" Parent ")).toBe("parent");
    expect(normalizeAuthRole("CHILD")).toBe("child");
    expect(normalizeAuthRole(" pet ")).toBe("pet");
    expect(normalizeAuthRole("admin")).toBeNull();
  });

  it("uses a normalized stored role when the roster omits its role", () => {
    memberCache.value = [{ name: "Caspian", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: " Parent " }));
    renderProvider();

    expect(ctxRef.current?.currentUser?.role).toBe("parent");
    expect(JSON.parse(localStorage.getItem("consuela-auth-user")!).role).toBe("parent");
  });

  it("preserves the active role when a roster update omits its role", () => {
    memberCache.value = [{ name: "Caspian", role: "Child", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: " child " }));
    renderProvider();

    memberCache.value = [{ name: "Caspian", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    act(() => {
      window.dispatchEvent(new Event("consuela-members-updated"));
    });

    expect(ctxRef.current?.currentUser?.role).toBe("child");
    expect(JSON.parse(localStorage.getItem("consuela-auth-user")!).role).toBe("child");
  });

  it("signs out when a roster update contains an explicit invalid role", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))));
    memberCache.value = [{ name: "Caspian", role: "child", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: "child" }));
    renderProvider();

    memberCache.value = [{ name: "Caspian", role: "admin", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    act(() => {
      window.dispatchEvent(new Event("consuela-members-updated"));
    });

    expect(ctxRef.current?.currentUser).toBeNull();
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
  });

  it("keeps role reconciliation when sanitized persistence cannot write", () => {
    memberCache.value = [{ name: "Caspian", role: "child", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: "child" }));
    renderProvider();

    memberCache.value = [{ name: "Caspian", role: "Parent", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    act(() => {
      window.dispatchEvent(new Event("consuela-members-updated"));
    });

    expect(ctxRef.current?.currentUser?.role).toBe("parent");
  });

  it("rejects an unsupported hydrated role", () => {
    memberCache.value = [{ name: "Caspian", role: "admin", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: "child" }));
    renderProvider();

    expect(ctxRef.current?.currentUser).toBeNull();
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
  });

  it("reconciles and persists a roster role when members update", () => {
    memberCache.value = [{ name: "Caspian", role: "Child", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    localStorage.setItem("consuela-auth-user", JSON.stringify({ id: 7, name: "Caspian", role: " child " }));
    renderProvider();

    memberCache.value = [{ name: "Caspian", role: "Parent", emoji: "🧒", color: "green", avatarSize: "md", glow: false }];
    act(() => {
      window.dispatchEvent(new Event("consuela-members-updated"));
    });

    expect(ctxRef.current?.currentUser?.role).toBe("parent");
    expect(JSON.parse(localStorage.getItem("consuela-auth-user")!).role).toBe("parent");
  });

  it("removes auth listeners and the inactivity interval on unmount", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { root } = renderProvider();
    const activityHandler = addListener.mock.calls.find(([event]) => event === "mousemove")?.[1];
    const membersHandler = addListener.mock.calls.find(([event]) => event === "consuela-members-updated")?.[1];
    const intervalHandle = setIntervalSpy.mock.results.at(-1)?.value;

    expect(activityHandler).toEqual(expect.any(Function));
    expect(membersHandler).toEqual(expect.any(Function));
    expect(intervalHandle).toBeDefined();

    unmountRoot(root);

    expect(removeListener).toHaveBeenCalledWith("mousemove", activityHandler);
    expect(removeListener).toHaveBeenCalledWith("consuela-members-updated", membersHandler);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
  });
});

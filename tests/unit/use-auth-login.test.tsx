// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Task 9 — login must go through POST /api/auth/login and persist the
// sanitized server member WITHOUT any pin field in localStorage.
vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => []),
    selectMembersDetailed: vi.fn(() => []),
    refreshCaches: vi.fn(async () => {}),
  },
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { sessionTtlSeconds } from "@/lib/session-policy";

const ctxRef: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const ctx = useAuth();
  useEffect(() => {
    ctxRef.current = ctx;
  });
  return null;
}

function renderProvider(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(<AuthProvider><Probe /></AuthProvider> as ReactElement));
  return el;
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
    ctxRef.current = null;
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

  it("stores nothing when the server rejects the pin", async () => {
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

    expect(outcome?.success).toBe(false);
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();
    expect(ctxRef.current!.isLoggedIn).toBe(false);

    vi.unstubAllGlobals();
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

  // The client countdown is a UX hint, never a licence to outlive the signed
  // cookie: signing in may not promise more than the role's server window, and
  // a rotation is driven by activity only — never by the sign-in itself.
  it("signing in promises no more than the parent's server window and never rotates on its own", async () => {
    const parentMember = { ...SANITIZED_MEMBER, id: 1, name: "Rebecca", role: "parent" as const, emoji: "👩", color: "violet" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, member: parentMember }),
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();
    await act(async () => {
      await ctxRef.current!.login("Rebecca", "1010");
    });

    expect(ctxRef.current!.sessionRemainingMs).toBe(sessionTtlSeconds("parent") * 1000);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/auth/touch")).toBe(false);

    vi.unstubAllGlobals();
  });

  // D4 — the role is what selects the window. A role outside the session
  // vocabulary must fail closed instead of hydrating a NaN deadline.
  it("refuses a member whose role is outside the session vocabulary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, member: { ...SANITIZED_MEMBER, role: "guest-admin" } }),
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();
    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await ctxRef.current!.login("Caspian", "1010");
    });

    expect(outcome?.success).toBe(false);
    expect(ctxRef.current!.isLoggedIn).toBe(false);
    expect(ctxRef.current!.currentUser).toBeNull();
    expect(localStorage.getItem("consuela-auth-user")).toBeNull();

    vi.unstubAllGlobals();
  });
});

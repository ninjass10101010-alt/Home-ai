// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Task 4 — quickLogin must go through POST /api/auth/quick-login (no PIN is
// ever sent) and share login's post-success flow: same localStorage shape
// (now carrying age), same session/flush side effects. Any non-200 fails
// closed WITHOUT signing in (the UI falls back to the PIN modal).
const pbDbMocks = vi.hoisted(() => ({
  findAuthSession: vi.fn(),
  createAuthSession: vi.fn(),
  deleteAuthSession: vi.fn(),
}));

vi.mock("@/db/pb-db", () => ({
  db: pbDbMocks,
}));

vi.mock("@/db", () => ({
  db: {
    selectMembers: vi.fn(() => []),
    selectMembersDetailed: vi.fn(() => []),
    refreshCaches: vi.fn(async () => {}),
  },
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

const ctxRef: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const ctx = useAuth();
  useEffect(() => {
    ctxRef.current = ctx;
  });
  return null;
}

function renderAuthHook() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() =>
    createRoot(el).render(createElement(AuthProvider, null, createElement(Probe)) as ReactElement)
  );
  return { result: ctxRef };
}

describe("useAuth.quickLogin — PIN-free sign-in for under-10 kids", () => {
  beforeEach(() => {
    localStorage.clear();
    ctxRef.current = null;
    pbDbMocks.findAuthSession.mockReset().mockResolvedValue(null);
    pbDbMocks.createAuthSession.mockReset().mockResolvedValue(null);
    pbDbMocks.deleteAuthSession.mockReset().mockResolvedValue(null);
  });

  it("quickLogin signs in via /api/auth/quick-login and stores the auth user", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true, status: 200, json: async () => ({ success: true, member: { id: "7", name: "Caspian", role: "child", emoji: "🧒", color: "green", age: 5 } }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);
    const { result } = renderAuthHook();
    await act(async () => { const r = await result.current!.quickLogin("Caspian"); expect(r.success).toBe(true); });
    expect(fetchMock.mock.calls.some(([u]: any) => u === "/api/auth/quick-login")).toBe(true);
    expect(localStorage.getItem("consuela-auth-user")).toContain('"age":5');
    vi.unstubAllGlobals();
  });

  it("quickLogin failure does not sign in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "pin_required" }) })) as any);
    const { result } = renderAuthHook();
    await act(async () => { const r = await result.current!.quickLogin("Jasmine"); expect(r.success).toBe(false); });
    expect(result.current!.currentUser).toBeNull();
    vi.unstubAllGlobals();
  });
});

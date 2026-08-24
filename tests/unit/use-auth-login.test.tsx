// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Task 9 — login must go through POST /api/auth/login and persist the
// sanitized server member WITHOUT any pin field in localStorage.
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
    pbDbMocks.findAuthSession.mockReset().mockResolvedValue(null);
    pbDbMocks.createAuthSession.mockReset().mockResolvedValue(null);
    pbDbMocks.deleteAuthSession.mockReset().mockResolvedValue(null);
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
});

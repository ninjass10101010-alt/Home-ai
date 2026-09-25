// @vitest-environment jsdom
// Session rotation from throttled browser activity plus an idle logout that
// can never outlive the signed cookie. The client countdown is a UX hint; the
// server-signed cookie is the boundary, so a rotation the server refused never
// buys the browser more time.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: () => [
      { name: "Caspian Garcia", role: "child", emoji: "🧒", color: "cyan", avatarSize: "md", glow: false, age: 5 },
      { name: "Rebecca (Mom)", role: "parent", emoji: "👩", color: "violet", avatarSize: "md", glow: false },
    ],
    selectMembers: () => [],
  },
}));

vi.mock("@/lib/pending-writes", () => ({ flushPendingWrites: vi.fn(async () => {}) }));

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { sessionTtlSeconds, type SessionRole } from "@/lib/session-policy";

const TOUCH_URL = "/api/auth/touch";
const AUTH_KEY = "consuela-auth-user";
const TOUCH_THROTTLE_MS = 60_000;
const TOUCH_ATTEMPT_FLOOR_MS = 10_000;
const MEMBER_BY_ROLE: Record<SessionRole, { name: string; emoji: string; color: string; id: number }> = {
  parent: { name: "Rebecca (Mom)", emoji: "👩", color: "violet", id: 1 },
  child: { name: "Caspian Garcia", emoji: "🧒", color: "cyan", id: 6 },
  pet: { name: "Rex (Dog)", emoji: "🐶", color: "amber", id: 9 },
};

interface Reply {
  status: number;
  body: unknown;
}

function jsonReply(reply: Reply): Response {
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => reply.body,
  } as unknown as Response;
}

function touchOk(role: SessionRole, expiresIn = sessionTtlSeconds(role)): Reply {
  return {
    status: 200,
    body: {
      ok: true,
      member: { memberId: String(MEMBER_BY_ROLE[role].id), name: MEMBER_BY_ROLE[role].name, role },
      expiresIn,
    },
  };
}

let touchReply: () => Reply = () => touchOk("child");
let touchGate: Promise<void> | null = null;
let touchRejects = false;

const fetchMock = vi.fn(async (input: unknown) => {
  if (String(input) === TOUCH_URL) {
    if (touchGate) await touchGate;
    if (touchRejects) throw new TypeError("Failed to fetch");
    return jsonReply(touchReply());
  }
  return jsonReply({ status: 200, body: { ok: true } });
});

function touchCalls(): unknown[][] {
  return fetchMock.mock.calls.filter(([input]) => String(input) === TOUCH_URL);
}

let activeRoot: Root | null = null;
const ctxRef: { current: ReturnType<typeof useAuth> | null } = { current: null };

function Probe() {
  const ctx = useAuth();
  useEffect(() => {
    ctxRef.current = ctx;
  });
  return null;
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
  return el;
}

async function renderProvider(): Promise<HTMLElement> {
  return renderAsync(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

async function activity(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("click"));
  });
}

async function idleFor(totalMs: number, stepMs = 10_000): Promise<void> {
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(stepMs, remaining);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(chunk);
    });
    remaining -= chunk;
  }
}

async function stayActiveFor(totalMs: number, stepMs = 5_000): Promise<void> {
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(stepMs, remaining);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(chunk);
    });
    await activity();
    remaining -= chunk;
  }
}

function seedStored(role: SessionRole): void {
  const member = MEMBER_BY_ROLE[role];
  const record: Record<string, unknown> = {
    id: member.id,
    name: member.name,
    role,
    emoji: member.emoji,
    color: member.color,
    avatarSize: "md",
    glow: false,
  };
  if (role !== "parent") record.age = 5;
  localStorage.setItem(AUTH_KEY, JSON.stringify(record));
}

function storedRole(): string | null {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return null;
  return (JSON.parse(stored) as { role?: string }).role ?? null;
}

let consoleErrors: unknown[][] = [];
const originalConsoleError = console.error;

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    originalConsoleError(...args);
    consoleErrors.push(args);
  });
  document.body.innerHTML = "";
  localStorage.clear();
  ctxRef.current = null;
  fetchMock.mockClear();
  touchReply = () => touchOk("child");
  touchGate = null;
  touchRejects = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  const actWarnings = consoleErrors.filter((args) => args.map(String).join(" ").includes("not wrapped in act"));
  vi.restoreAllMocks();
  expect(actWarnings).toEqual([]);
});

describe("AuthProvider — throttled session touch", () => {
  it("coalesces activity into one touch per minute", async () => {
    seedStored("child");
    touchReply = () => touchOk("child", 900);

    await renderProvider();
    expect(ctxRef.current?.isLoggedIn).toBe(true);
    expect(touchCalls()).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new Event("mousemove"));
      window.dispatchEvent(new Event("click"));
      window.dispatchEvent(new Event("scroll"));
    });

    expect(touchCalls()).toHaveLength(1);
  });

  it("POSTs /api/auth/touch with no body and a forced rotation is throttled too", async () => {
    seedStored("child");
    touchReply = () => touchOk("child", 900);

    await renderProvider();
    await activity();

    const [url, init] = touchCalls()[0] as [string, RequestInit];
    expect(url).toBe(TOUCH_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();

    await activity();
    expect(touchCalls()).toHaveLength(1);
  });

  it("allows the next touch only once 60 seconds have passed", async () => {
    seedStored("child");
    touchReply = () => touchOk("child", 900);

    await renderProvider();
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_THROTTLE_MS - 1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(2);
  });

  it("never runs two rotations at once", async () => {
    seedStored("child");
    let open: () => void = () => {};
    touchGate = new Promise<void>((resolve) => { open = resolve; });
    touchReply = () => ({ status: 503, body: { error: "unreachable" } });

    await renderProvider();
    await activity();
    await activity();
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { open(); await touchGate; });
    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS); });
    await activity();
    expect(touchCalls()).toHaveLength(2);
  });

  it("bounds a failing endpoint to one request per floor, not one per activity event", async () => {
    seedStored("child");
    touchReply = () => ({ status: 503, body: { error: "unreachable" } });

    await renderProvider();
    for (let i = 0; i < 50; i++) {
      await activity();
    }
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS - 1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(2);

    for (let i = 0; i < 50; i++) {
      await activity();
    }
    expect(touchCalls()).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS * 6); });
    await activity();
    expect(touchCalls()).toHaveLength(3);
  });

  it("a hung request never stacks", async () => {
    seedStored("child");
    touchGate = new Promise<void>(() => {});

    await renderProvider();
    for (let i = 0; i < 20; i++) {
      await activity();
    }
    expect(touchCalls()).toHaveLength(1);
  });

  it("bounds a rejected fetch to the same floor as a failed response", async () => {
    seedStored("child");
    touchRejects = true;

    await renderProvider();
    for (let i = 0; i < 30; i++) {
      await activity();
    }
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS - 1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(2);
    expect(ctxRef.current?.isLoggedIn).toBe(true);
  });

  it("signs nobody in is never rotated", async () => {
    touchReply = () => touchOk("parent");

    await renderProvider();
    await activity();

    expect(ctxRef.current?.isLoggedIn).toBe(false);
    expect(touchCalls()).toHaveLength(0);
  });

  it("adopts the identity the server answered with", async () => {
    seedStored("parent");
    touchReply = () => ({
      status: 200,
      body: {
        ok: true,
        member: { memberId: "1", name: "Rebecca (Mom)", role: "child" },
        expiresIn: 900,
      },
    });

    await renderProvider();
    await activity();

    expect(ctxRef.current?.currentUser?.role).toBe("child");
    expect(storedRole()).toBe("child");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(ctxRef.current?.sessionRemainingMs).toBeLessThanOrEqual(900_000);
  });

  it("never lets the countdown promise more than the signed cookie", async () => {
    seedStored("parent");
    touchReply = () => touchOk("parent", 1800);

    await renderProvider();
    await activity();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(ctxRef.current?.sessionRemainingMs).toBeLessThanOrEqual(1_800_000);
    expect(ctxRef.current?.sessionRemainingMs).toBeGreaterThan(0);
  });
});

describe("AuthProvider — a rotation the server refuses", () => {
  it("does not extend the session when the touch fails", async () => {
    seedStored("child");
    touchReply = () => touchOk("child", 900);

    await renderProvider();
    await activity();
    expect(touchCalls()).toHaveLength(1);

    touchReply = () => ({ status: 503, body: { error: "unreachable" } });
    for (let i = 0; i < 8; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      await activity();
    }
    expect(touchCalls().length).toBeGreaterThan(1);
    expect(ctxRef.current?.isLoggedIn).toBe(true);
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
  });

  it("logs out at the last successful rotation even while the user stays active", async () => {
    seedStored("child");
    touchReply = () => touchOk("child", 900);

    await renderProvider();
    await activity();
    expect(touchCalls()).toHaveLength(1);

    touchReply = () => ({ status: 503, body: { error: "unreachable" } });
    await stayActiveFor(15 * 60 * 1000 - 1_000, 5_000);
    expect(ctxRef.current?.isLoggedIn).toBe(true);
    expect(touchCalls().length).toBeGreaterThan(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(touchCalls().length).toBeGreaterThan(1);
    expect(ctxRef.current?.isLoggedIn).toBe(false);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("signs the member out when the touch is refused as expired (401)", async () => {
    seedStored("child");
    touchReply = () => ({ status: 401, body: { error: "session_expired" } });

    await renderProvider();
    await activity();

    expect(touchCalls()).toHaveLength(1);
    expect(ctxRef.current?.isLoggedIn).toBe(false);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("signs the member out when the touch is refused as forbidden (403)", async () => {
    seedStored("parent");
    touchReply = () => ({ status: 403, body: { error: "adult_only" } });

    await renderProvider();
    await activity();

    expect(touchCalls()).toHaveLength(1);
    expect(ctxRef.current?.isLoggedIn).toBe(false);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("a refused rotation buys the short attempt floor, never the 60s success cooldown", async () => {
    seedStored("child");
    touchReply = () => ({ status: 503, body: { error: "unreachable" } });

    await renderProvider();
    await activity();
    await activity();
    expect(touchCalls()).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS); });
    await activity();
    expect(touchCalls()).toHaveLength(2);
    await activity();
    expect(touchCalls()).toHaveLength(2);

    touchReply = () => touchOk("child", 900);
    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_ATTEMPT_FLOOR_MS); });
    await activity();
    expect(touchCalls()).toHaveLength(3);

    await activity();
    expect(touchCalls()).toHaveLength(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUCH_THROTTLE_MS - 1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await activity();
    expect(touchCalls()).toHaveLength(4);
  });
});

describe("AuthProvider — role-aware timeouts", () => {
  it("a CHILD session ends at 15 idle minutes (kid window)", async () => {
    seedStored("child");
    await renderProvider();
    await idleFor(14 * 60 * 1000);
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("a PARENT session survives 16 idle minutes (30-minute window)", async () => {
    seedStored("parent");
    await renderProvider();
    await idleFor(16 * 60 * 1000);
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
  });

  it("a PARENT session ends at 30 idle minutes (parent window)", async () => {
    seedStored("parent");
    await renderProvider();
    await idleFor(29 * 60 * 1000);
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it("activity keeps a kid session alive past 15 minutes", async () => {
    seedStored("child");
    await renderProvider();
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 1000); });
      await act(async () => { window.dispatchEvent(new Event("click")); });
    }
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
  });

  it("a kid session warns five minutes out", async () => {
    seedStored("child");
    await renderProvider();
    await idleFor(9 * 60 * 1000);
    expect(ctxRef.current?.sessionWarning).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(90 * 1000); });
    expect(ctxRef.current?.sessionWarning).toBe(true);
    expect(ctxRef.current?.sessionRemainingMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("a parent session warns thirty seconds out", async () => {
    seedStored("parent");
    await renderProvider();
    await idleFor(29 * 60 * 1000 - 10_000);
    expect(ctxRef.current?.sessionWarning).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(ctxRef.current?.sessionWarning).toBe(true);
  });
});

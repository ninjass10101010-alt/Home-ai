/**
 * Bug 5 (P1) — time capsules NEVER unlocked.
 *
 * `checkAndUnlockCapsules()` existed and worked, and had no caller: no cron
 * route, no line in `scripts/consuela/host-crontab.example`, no read path. A
 * parent who wrote a time-locked capsule therefore saw `contents: []` forever,
 * on the unlock date and every day after it.
 *
 * Two fixes, because either alone leaves a dead feature:
 *
 *  1. A CRON ROUTE under `/api/cron/**`, bearer-gated by `isCronAuthorized` like
 *     every other host-crontab route, plus a crontab line in the example. This
 *     is the belt — it unlocks even when nobody opens the page.
 *  2. THE UNLOCK ON THE READ PATH. The braces are the suspenders: a capsule
 *     opens the day it should whether or not ops remembered to install the host
 *     crontab line. Without this the feature depends on a NAS-side change that
 *     nothing in the app verifies.
 *
 * A GET that unlocks is still a GET — the sweep only ever moves a capsule whose
 * `unlockDate` has already passed, so it can never open one early.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

interface Session {
  name: string;
  memberId: string;
  role: string;
}

const mocks = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(() => true),
  getUserId: vi.fn<() => Promise<string>>(async () => "Alex"),
  requireSession: vi.fn<() => Promise<Session | null>>(async () => ({
    name: "Alex",
    memberId: "m-alex",
    role: "parent",
  })),
  isLegacyOwner: vi.fn((id: string | null | undefined) => id === "demo-user"),
  sanitizeUserId: vi.fn((raw: string | null | undefined) => (raw ?? "").trim() || "demo-user"),
  getUserCapsules: vi.fn<() => Promise<unknown[]>>(async () => []),
  checkAndUnlockCapsules: vi.fn<() => Promise<number>>(async () => 0),
}));

vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: mocks.isCronAuthorized }));
vi.mock("@/lib/auth", () => ({
  getUserId: mocks.getUserId,
  requireSession: mocks.requireSession,
  isLegacyOwner: mocks.isLegacyOwner,
  sanitizeUserId: mocks.sanitizeUserId,
}));
vi.mock("@/lib/live-member", () => ({ getLiveMemberById: vi.fn(), verifyLiveParentSession: vi.fn() }));
vi.mock("@/lib/time-capsule", () => ({
  getUserCapsules: mocks.getUserCapsules,
  checkAndUnlockCapsules: mocks.checkAndUnlockCapsules,
}));

import { POST as UNLOCK_CRON_POST } from "@/app/api/cron/time-capsules/unlock/route";
import { GET as LIST_GET } from "@/app/api/time-capsules/route";
import { GET as SINGLE_GET } from "@/app/api/time-capsules/[id]/route";
import { POST as LEGACY_UNLOCK_POST } from "@/app/api/time-capsules/unlock/route";

async function bodyOf(res: Response) {
  return (await res.json()) as any;
}

function cronReq(auth = "Bearer secret") {
  return new NextRequest("http://localhost/api/cron/time-capsules/unlock", {
    method: "POST",
    headers: { authorization: auth },
  });
}

function listReq() {
  return new NextRequest("http://localhost/api/time-capsules", {
    headers: { cookie: "consuela_session=token" },
  });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof (fn as any).mockReset === "function") (fn as any).mockReset();
  }
  vi.stubEnv("CRON_SECRET", "secret");
  mocks.isCronAuthorized.mockReturnValue(true);
  mocks.requireSession.mockResolvedValue({ name: "Alex", memberId: "m-alex", role: "parent" });
  mocks.getUserId.mockResolvedValue("Alex");
  mocks.getUserCapsules.mockResolvedValue([]);
  mocks.checkAndUnlockCapsules.mockResolvedValue(0);
});

describe("Bug 5 — the cron route exists and is bearer-gated", () => {
  it("401s without the CRON_SECRET bearer", async () => {
    mocks.isCronAuthorized.mockReturnValue(false);
    const res = await UNLOCK_CRON_POST(cronReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.checkAndUnlockCapsules).not.toHaveBeenCalled();
  });

  it("unlocks and reports how many moved", async () => {
    mocks.checkAndUnlockCapsules.mockResolvedValue(2);
    const res = await UNLOCK_CRON_POST(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.unlockedCount).toBe(2);
  });

  it("degrades to 200 {ok:false} rather than a false success", async () => {
    mocks.checkAndUnlockCapsules.mockRejectedValue(new Error("pocketbase down"));
    const res = await UNLOCK_CRON_POST(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.unlockedCount).toBe(0);
  });
});

describe("Bug 5 — the host crontab example actually invokes it", () => {
  const crontab = readFileSync(
    join(process.cwd(), "scripts/consuela/host-crontab.example"),
    "utf8",
  );

  it("has a line for the time-capsule unlock route", () => {
    const line = crontab
      .split("\n")
      .find((l) => l.includes("/api/cron/time-capsules/unlock"));
    expect(line, "host-crontab.example has no unlock line").toBeTruthy();
    // POST-only route + the shared secret, like every sibling line.
    expect(line).toMatch(/-X POST/);
    expect(line).toMatch(/Authorization: Bearer \$CONSUELA_CRON_SECRET/);
    expect(line).not.toMatch(/__replace_me__/);
  });

  it("does not break the existing eight lines", () => {
    for (const route of [
      "/api/cron/consuela/suggestions",
      "/api/cron/consuela/briefing",
      "/api/cron/consuela/google-sync",
      "/api/cron/consuela/telegram-poll",
      "/api/cron/consuela/ha-todo-mirror",
      "/api/cron/calendar/score-importance",
      "/api/cron/consuela/weather-alert",
      "/api/cron/consuela/calendar-alert",
    ]) {
      expect(crontab, `missing crontab line for ${route}`).toContain(route);
    }
  });
});

describe("Bug 5 — the read path unlocks too (the crontab is only the belt)", () => {
  it("GET /api/time-capsules sweeps before it lists", async () => {
    mocks.checkAndUnlockCapsules.mockResolvedValue(1);
    const res = await LIST_GET(listReq());
    expect(res.status).toBe(200);
    expect(mocks.checkAndUnlockCapsules).toHaveBeenCalled();
  });

  it("GET /api/time-capsules/[id] sweeps before it reads", async () => {
    mocks.checkAndUnlockCapsules.mockResolvedValue(1);
    const res = await SINGLE_GET(listReq(), { params: Promise.resolve({ id: "cap-1" }) });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(mocks.checkAndUnlockCapsules).toHaveBeenCalled();
  });

  it("still lists the capsules when the sweep fails", async () => {
    mocks.checkAndUnlockCapsules.mockRejectedValue(new Error("pocketbase down"));
    mocks.getUserCapsules.mockResolvedValue([{ id: "cap-1", title: "For 2031" }]);
    const res = await LIST_GET(listReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capsules).toHaveLength(1);
  });

  it("a sweep is skipped entirely for an unauthenticated read", async () => {
    mocks.requireSession.mockResolvedValue(null);
    const res = await LIST_GET(listReq());
    expect(res.status).toBe(401);
    expect(mocks.checkAndUnlockCapsules).not.toHaveBeenCalled();
  });

  it("does not sweep on a write (POST create stays a pure write)", async () => {
    const post = new NextRequest("http://localhost/api/time-capsules", {
      method: "POST",
      headers: { cookie: "consuela_session=token", "content-type": "application/json" },
      body: JSON.stringify({ title: "For 2031", unlockDate: "2031-01-01T00:00:00.000Z" }),
    });
    const { POST } = await import("@/app/api/time-capsules/route");
    const res = await POST(post);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.checkAndUnlockCapsules).not.toHaveBeenCalled();
  });
});

describe("Bug 5 — the legacy /api/time-capsules/unlock route is not an open door", () => {
  it("401s an unauthenticated sweep (it used to have no auth at all)", async () => {
    mocks.requireSession.mockResolvedValue(null);
    const res = await LEGACY_UNLOCK_POST(
      new NextRequest("http://localhost/api/time-capsules/unlock", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toBe("unauthorized");
    expect(mocks.checkAndUnlockCapsules).not.toHaveBeenCalled();
  });

  it("still sweeps for a signed-in member", async () => {
    mocks.checkAndUnlockCapsules.mockResolvedValue(3);
    const res = await LEGACY_UNLOCK_POST(
      new NextRequest("http://localhost/api/time-capsules/unlock", {
        method: "POST",
        headers: { cookie: "consuela_session=token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.success).toBe(true);
    expect(body.unlockedCount).toBe(3);
  });
});
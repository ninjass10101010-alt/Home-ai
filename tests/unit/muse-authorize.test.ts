import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  readMuseRow: vi.fn(),
  touchMuseUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/muse/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/muse/store")>();
  return {
    ...actual,
    readMuseRow: mocks.readMuseRow,
    touchMuseUsage: mocks.touchMuseUsage,
  };
});

import { authorizeMuseRequest } from "@/lib/muse/auth";
import { signMuseToken } from "@/lib/muse/token";
import { generateKey } from "@/lib/muse/store";

const SECRET = "test-secret-0123456789";
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  mocks.readMuseRow.mockReset();
  mocks.touchMuseUsage.mockReset();
  mocks.touchMuseUsage.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

function row(overrides: Record<string, unknown> = {}) {
  const g = generateKey();
  return {
    id: "muse1",
    keyHash: g.keyHash,
    keyPrefix: g.keyPrefix,
    version: 1,
    enabled: true,
    adminEnabled: false,
    rateLimitPerMin: 120,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

function req(token?: string, ip = "1.2.3.4") {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/muse/whoami", { headers });
}

describe("authorizeMuseRequest", () => {
  it("401s when the Authorization header is missing", async () => {
    mocks.readMuseRow.mockResolvedValue(row());
    expect(await authorizeMuseRequest(req())).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect(mocks.touchMuseUsage).not.toHaveBeenCalled();
  });

  it("401s on a malformed bearer token", async () => {
    mocks.readMuseRow.mockResolvedValue(row());
    expect(await authorizeMuseRequest(req("not-a-token"))).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("401s when no MUSE row exists", async () => {
    mocks.readMuseRow.mockResolvedValue(null);
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(await authorizeMuseRequest(req(token))).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("403s muse_disabled when the row is disabled but the token is otherwise valid", async () => {
    mocks.readMuseRow.mockResolvedValue(row({ enabled: false }));
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(await authorizeMuseRequest(req(token))).toEqual({
      ok: false,
      status: 403,
      error: "muse_disabled",
    });
    expect(mocks.touchMuseUsage).not.toHaveBeenCalled();
  });

  it("401s when the token version was rotated away", async () => {
    mocks.readMuseRow.mockResolvedValue(row({ version: 2 }));
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(await authorizeMuseRequest(req(token))).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("returns ok for a valid token and touches usage", async () => {
    mocks.readMuseRow.mockResolvedValue(row());
    const { token } = signMuseToken({ ver: 1, adm: false });
    expect(await authorizeMuseRequest(req(token, "5.6.7.8"))).toEqual({ ok: true, adm: false });
    expect(mocks.touchMuseUsage).toHaveBeenCalledWith("5.6.7.8");
  });

  it("requires BOTH the token admin claim and row.adminEnabled for adm", async () => {
    const cases: Array<[boolean, boolean, boolean]> = [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ];
    for (const [claim, rowAdmin, expected] of cases) {
      mocks.readMuseRow.mockResolvedValue(row({ adminEnabled: rowAdmin }));
      const { token } = signMuseToken({ ver: 1, adm: claim });
      const out = await authorizeMuseRequest(req(token));
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.adm).toBe(expected);
    }
  });
});

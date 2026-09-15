import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  readMuseRow: vi.fn(),
  touchMuseUsage: vi.fn().mockResolvedValue(undefined),
  writeMuseLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/muse/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/muse/store")>();
  return {
    ...actual,
    readMuseRow: mocks.readMuseRow,
    touchMuseUsage: mocks.touchMuseUsage,
  };
});
vi.mock("@/lib/muse/log", () => ({ writeMuseLog: mocks.writeMuseLog }));

import { POST } from "@/app/api/muse/auth/login/route";
import { generateKey } from "@/lib/muse/store";
import { __resetMuseLimits, registerLoginFailure } from "@/lib/muse/ratelimit";

const SECRET = "test-secret-0123456789";
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  __resetMuseLimits();
  mocks.readMuseRow.mockReset();
  mocks.touchMuseUsage.mockReset();
  mocks.touchMuseUsage.mockResolvedValue(undefined);
  mocks.writeMuseLog.mockReset();
  mocks.writeMuseLog.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

function makeRow(overrides: Record<string, unknown> = {}) {
  const g = generateKey();
  const row = {
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
  return { row, key: g.key };
}

function loginReq(body: unknown, ip = "1.2.3.4") {
  return new NextRequest("http://localhost/api/muse/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/muse/auth/login", () => {
  it("401s invalid_key on a wrong key and writes an auth_fail log", async () => {
    const { row } = makeRow();
    mocks.readMuseRow.mockResolvedValue(row);
    const res = await POST(loginReq({ key: "muse_wrongwrongwrong" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_key");
    expect(mocks.writeMuseLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auth_fail", ok: false })
    );
  });

  it("401s invalid_key when no row exists (never reveals existence)", async () => {
    mocks.readMuseRow.mockResolvedValue(null);
    const res = await POST(loginReq({ key: "muse_whatever" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_key");
  });

  it("401s invalid_key when the identity is disabled", async () => {
    const { row, key } = makeRow({ enabled: false });
    mocks.readMuseRow.mockResolvedValue(row);
    const res = await POST(loginReq({ key }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_key");
    expect(mocks.touchMuseUsage).not.toHaveBeenCalled();
  });

  it("issues a token + metadata on success and touches usage", async () => {
    const { row, key } = makeRow({ adminEnabled: true });
    mocks.readMuseRow.mockResolvedValue(row);
    const res = await POST(loginReq({ key }, "5.6.7.8"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.scopes).toEqual(["tools"]);
    expect(body.admin).toBe(true);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mocks.touchMuseUsage).toHaveBeenCalledWith("5.6.7.8");
    expect(mocks.writeMuseLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "login", ok: true, keyPrefix: row.keyPrefix })
    );
    const logged = JSON.stringify(mocks.writeMuseLog.mock.calls);
    expect(logged).not.toContain(key);
  });

  it("400s invalid_body on malformed or non-string key", async () => {
    mocks.readMuseRow.mockResolvedValue(makeRow().row);
    for (const body of [{}, { key: 123 }, { key: null }, "not json", ""]) {
      const res = await POST(loginReq(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
  });

  it("429s rate_limited on the 6th attempt in a minute", async () => {
    const { row, key } = makeRow();
    mocks.readMuseRow.mockResolvedValue(row);
    const ip = "9.9.9.9";
    for (let i = 0; i < 5; i++) {
      expect((await POST(loginReq({ key }, ip))).status).toBe(200);
    }
    const res = await POST(loginReq({ key }, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(mocks.writeMuseLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rate_limited", ok: false })
    );
  });

  it("429s locked after 10 consecutive failures", async () => {
    mocks.readMuseRow.mockResolvedValue(makeRow().row);
    const ip = "5.5.5.5";
    for (let i = 0; i < 10; i++) registerLoginFailure(ip);
    const res = await POST(loginReq({ key: "muse_whatever000000" }, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("locked");
  });
});

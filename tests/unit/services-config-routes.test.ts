import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
}));

import { GET, PUT, DELETE } from "@/app/api/services/config/route";
import { signSession, SESSION_COOKIE } from "@/lib/session";

function pbForRows(rows: any[]) {
  const store = [...rows];
  return {
    store,
    pb: {
      collection: () => ({
        getFullList: async () => store,
        update: async (id: string, payload: any) => {
          const i = store.findIndex((r) => r.id === id);
          if (i >= 0) Object.assign(store[i], payload);
          return { id };
        },
        create: async (payload: any) => {
          store.push({ id: `new-${store.length + 1}`, ...payload });
          return { id: "created" };
        },
        delete: async (id: string) => {
          const i = store.findIndex((r) => r.id === id);
          if (i >= 0) store.splice(i, 1);
          return {};
        },
      }),
    },
  };
}

async function sessionCookie(role = "parent"): Promise<string> {
  const token = await signSession({ memberId: "m1", name: "Rebecca", role });
  return `${SESSION_COOKIE}=${token}`;
}

function req(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/services/config", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("ADMIN_SECRET", "");
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=");
  mocks.withAdmin.mockReset();
  mocks.verifyPinAgainstAnyMember.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/services/config", () => {
  it("401s without a session", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
  });

  it("returns manifest with masked secrets and no raw values", async () => {
    const { pb } = pbForRows([
      { service: "hermes", key: "HERMES_API_URL", value: "http://h:8642", is_secret: false },
    ]);
    process.env.HERMES_API_KEY = "abcd";
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await GET(req("GET", undefined, { cookie: await sessionCookie() }));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('"value"');
    expect(raw).not.toContain("http://h:8642"); // non-secret config values also not echoed
  });

  it("includes every registry service for a signed-in adult", async () => {
    const { pb } = pbForRows([]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await GET(req("GET", undefined, { cookie: await sessionCookie() }));
    const body = await res.json();
    const ids = body.services.map((s: any) => s.id);
    expect(ids).toContain("home_assistant");
    expect(ids).toContain("gmail_emergency");
    const ha = body.services.find((s: any) => s.id === "home_assistant");
    const tokenField = ha.status.find((f: any) => f.key === "HA_TOKEN");
    expect(tokenField.secret).toBe(true);
  });
});

describe("PUT /api/services/config", () => {
  it("401s anonymous and 403s child sessions", async () => {
    expect((await PUT(req("PUT", { service: "themealdb", key: "MEALDB_KEY", value: "2" }))).status).toBe(401);

    mocks.verifyPinAgainstAnyMember.mockResolvedValue(null); // pin path dead
    const res = await PUT(
      req("PUT", { service: "themealdb", key: "MEALDB_KEY", value: "2" }, { cookie: await sessionCookie("child") })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
  });

  it("stores an ENCRYPTED value for secret fields via an adult session", async () => {
    const { pb, store } = pbForRows([]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await PUT(
      req(
        "PUT",
        { service: "telegram_alert", key: "TELEGRAM_BOT_TOKEN", value: "123456:AaBbCc" },
        { cookie: await sessionCookie() }
      )
    );
    expect(res.status).toBe(200);
    const stored = store[0];
    expect(stored.value).toMatch(/^v1\./);
    expect(stored.value).not.toContain("123456");
    expect(stored.is_secret).toBe(true);
    expect(stored.updated_by).toBe("Rebecca");
  });

  it("rejects non-registry pairs with 400", async () => {
    const res = await PUT(
      req(
        "PUT",
        { service: "home_assistant", key: "SESSION_SECRET", value: "x" },
        { cookie: await sessionCookie() }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_service_key");
  });
});

describe("DELETE /api/services/config", () => {
  it("removes the override so env wins again", async () => {
    const { pb, store } = pbForRows([{ id: "row1", service: "themealdb", key: "MEALDB_KEY", value: "9", is_secret: false }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await DELETE(
      req("DELETE", { service: "themealdb", key: "MEALDB_KEY" }, { cookie: await sessionCookie() })
    );
    expect(res.status).toBe(200);
    expect(store).toHaveLength(0);
  });

  it("is idempotent when nothing is stored", async () => {
    const { pb } = pbForRows([]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await DELETE(
      req("DELETE", { service: "themealdb", key: "MEALDB_KEY" }, { cookie: await sessionCookie() })
    );
    expect(res.status).toBe(200);
  });
});

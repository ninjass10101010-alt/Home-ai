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

import { POST as importPOST } from "@/app/api/services/import/route";
import { GET as runtimeGET } from "@/app/api/services/runtime/route";
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
          store.push({ id: `n${store.length + 1}`, ...payload });
          return { id: "created" };
        },
      }),
    },
  };
}

async function cookie(role = "parent"): Promise<string> {
  const token = await signSession({ memberId: "m1", name: "Rebecca", role });
  return `${SESSION_COOKIE}=${token}`;
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/services/x", {
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

describe("POST /api/services/import", () => {
  it("401s anonymous and 403s child sessions", async () => {
    expect(
      (await importPOST(req("POST", { entries: [] }))).status
    ).toBe(401);
    const child = await importPOST(
      req("POST", { entries: [{ service: "themealdb", key: "MEALDB_KEY", value: "2" }] }, { cookie: await cookie("child") })
    );
    expect(child.status).toBe(403);
  });

  it("imports registry pairs (encrypting secrets) and rejects unknown ones", async () => {
    const { pb, store } = pbForRows([]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await importPOST(
      req("POST", {
        entries: [
          { service: "instacart", key: "INSTACART_API_KEY", value: "ic-key-9" },
          { service: "nope", key: "WHATEVER", value: "x" },
          { service: "home_assistant", key: "HA_HOST", value: "" },
        ],
      }, { cookie: await cookie() })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.rejected).toEqual([
      { service: "nope", key: "WHATEVER", reason: "unknown_pair" },
      { service: "home_assistant", key: "HA_HOST", reason: "invalid_value" },
    ]);
    expect(store[0].value).toMatch(/^v1\./); // instacart secret encrypted
    expect(store[0].value).not.toContain("ic-key-9");
  });
});

describe("GET /api/services/runtime", () => {
  it("401s anonymous", async () => {
    expect((await runtimeGET(req("GET"))).status).toBe(401);
  });

  it("exposes publicRuntime fields via env fallback, nothing else", async () => {
    process.env.LAT = "42.7875";
    process.env.LON = "-86.1089";
    delete process.env.INSTACART_API_KEY;
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const res = await runtimeGET(req("GET", undefined, { cookie: await cookie() }));
    const body = await res.json();

    expect(body.runtime.weather_location).toEqual({ LAT: "42.7875", LON: "-86.1089" });
    expect(JSON.stringify(body)).not.toContain("INSTACART");
    delete process.env.LAT;
    delete process.env.LON;
  });
});

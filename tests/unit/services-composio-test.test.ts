import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { runServiceTest } from "../../src/lib/services/tests";

function pbForRows(rows: any[]) {
  return {
    pb: {
      collection: () => ({
        getFullList: async () => rows,
      }),
    },
  };
}

function mockFetch(status: number, json: Record<string, unknown> = {}) {
  return vi.fn(async () => ({ status, json: async () => json }));
}

beforeEach(() => {
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=");
  mocks.withAdmin.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runServiceTest — composio", () => {
  it("probes the live v3.1 tools endpoint (not the dead v1 endpoint)", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "ak_test");
    const fetchSpy = mockFetch(200);
    vi.stubGlobal("fetch", fetchSpy);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    await runServiceTest("composio");

    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe(
      "https://backend.composio.dev/api/v3.1/tools?limit=1"
    );
  });

  it("reports RED (ok:false) when Composio rejects the key with 401", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "ak_test");
    vi.stubGlobal("fetch", mockFetch(401));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("composio");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("401");
  });

  it("reports RED (ok:false) on 403/410-style rejections, not green 'reachable'", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "ak_test");
    vi.stubGlobal("fetch", mockFetch(410));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("composio");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("410");
  });

  it("reports GREEN only on 2xx", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "ak_test");
    vi.stubGlobal("fetch", mockFetch(200));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("composio");
    expect(result.ok).toBe(true);
  });

  it("short-circuits not_configured without an outbound call", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("composio");
    expect(result).toMatchObject({ ok: false, detail: "not_configured" });
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

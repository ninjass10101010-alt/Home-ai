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

beforeEach(() => {
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=");
  mocks.withAdmin.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runServiceTest", () => {
  it("short-circuits not_configured without any outbound call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("instacart");

    expect(result).toMatchObject({ ok: false, detail: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("telegram_alert: verifies bot via getMe and reports missing chat id", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    delete (process.env as any).TELEGRAM_ALERT_CHAT_ID;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { username: "consuela_bot" } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("telegram_alert");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("TELEGRAM_ALERT_CHAT_ID");
    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe("https://api.telegram.org/bot123:abc/getMe");
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("telegram_alert: ok when both token and chat id exist", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_ALERT_CHAT_ID = "-100";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { username: "b" } }) }))
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("telegram_alert");
    expect(result).toMatchObject({ ok: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
  });

  it("home_assistant: distinguishes reachable-but-bad-token", async () => {
    process.env.HA_HOST = "http://ha:8123";
    process.env.HA_TOKEN = "tok";
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("home_assistant");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("401");
    expect((fetchSpy.mock.calls[0] as any[])[0]).toBe("http://ha:8123/api/");
    delete process.env.HA_HOST;
    delete process.env.HA_TOKEN;
  });

  it("themealdb: invalid key detected via null meals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ meals: null }) }))
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    const result = await runServiceTest("themealdb");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("invalid key");
  });

  it("unknown service returns unknown_service", async () => {
    expect(await runServiceTest("nope")).toMatchObject({ ok: false, detail: "unknown_service" });
  });

  it("uses a 5s AbortSignal timeout on outbound calls", async () => {
    process.env.INSTACART_API_KEY = "k";
    let seenSignal: AbortSignal | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        seenSignal = init?.signal as AbortSignal | undefined;
        return Promise.resolve({ status: 200 });
      })
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([]).pb));

    await runServiceTest("instacart");

    expect(seenSignal).toBeTruthy();
    delete process.env.INSTACART_API_KEY;
  });
});

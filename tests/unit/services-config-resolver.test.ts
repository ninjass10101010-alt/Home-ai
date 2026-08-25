import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import {
  getServiceConfig,
  getServiceStatus,
} from "../../src/lib/services/config";

function pbForRows(rows: any[]) {
  return {
    collection: () => ({
      getFullList: vi.fn(async () => rows),
    }),
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  vi.stubEnv("CONSUELA_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=");
});

describe("getServiceConfig", () => {
  it("decrypts secret rows from PB", async () => {
    const { encryptSecret } = await import("@/lib/secret-box");
    const enc = encryptSecret("tok-123");
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(pbForRows([{ service: "home_assistant", key: "HA_TOKEN", value: enc, is_secret: true }]))
    );
    delete (process.env as any).HA_TOKEN;
    await expect(getServiceConfig("home_assistant", "HA_TOKEN")).resolves.toBe("tok-123");
  });

  it("returns plaintext rows as-is", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(pbForRows([{ service: "themealdb", key: "MEALDB_KEY", value: "2", is_secret: false }]))
    );
    await expect(getServiceConfig("themealdb", "MEALDB_KEY")).resolves.toBe("2");
  });

  it("falls back to env when stored ciphertext is corrupt (warns)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(pbForRows([{ service: "telegram_alert", key: "TELEGRAM_BOT_TOKEN", value: "v1.bad.bad.bad", is_secret: true }]))
    );
    process.env.TELEGRAM_BOT_TOKEN = "env-token";
    await expect(getServiceConfig("telegram_alert", "TELEGRAM_BOT_TOKEN")).resolves.toBe("env-token");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("falls back to env when no row exists", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([])));
    process.env.TELEGRAM_ALERT_CHAT_ID = "-100123";
    await expect(getServiceConfig("telegram_alert", "TELEGRAM_ALERT_CHAT_ID")).resolves.toBe("-100123");
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
  });

  it("returns null when neither DB nor env has it", async () => {
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbForRows([])));
    delete process.env.INSTACART_API_KEY;
    await expect(getServiceConfig("instacart", "INSTACART_API_KEY")).resolves.toBeNull();
  });

  it("rejects non-registry pairs without touching PB", async () => {
    const fn = vi.fn();
    mocks.withAdmin.mockImplementation(fn);
    await expect(getServiceConfig("home_assistant", "SESSION_SECRET")).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("getServiceStatus", () => {
  it("reports db/env/unset sources and a 2-char secret preview", async () => {
    const { encryptSecret } = await import("@/lib/secret-box");
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn(pbForRows([{ service: "hermes", key: "HERMES_API_URL", value: "http://h:8642", is_secret: false }]))
    );
    process.env.HERMES_API_KEY = "abcd";
    const status = await getServiceStatus("hermes");
    const url = status.find((f) => f.key === "HERMES_API_URL")!;
    expect(url).toMatchObject({ source: "db", set: true });
    const key = status.find((f) => f.key === "HERMES_API_KEY")!;
    expect(key).toMatchObject({ source: "env", set: true, preview: "cd" });
    delete process.env.HERMES_API_KEY;
  });
});

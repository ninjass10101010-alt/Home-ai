import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("../../src/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
}));

vi.mock("../../src/lib/free-communication", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock("../../src/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import {
  listHANotifyTargets,
  sendHANotification,
  broadcastHouseAlert,
} from "../../src/lib/ha/notify";

describe("listHANotifyTargets", () => {
  it("keeps only notify.* entities and sorts them", () => {
    const states = [
      { entity_id: "notify.zoe" },
      { entity_id: "light.kitchen" },
      { entity_id: "notify.alex" },
    ];
    expect(listHANotifyTargets(states)).toEqual(["notify.alex", "notify.zoe"]);
  });

  it("returns empty for no targets", () => {
    expect(listHANotifyTargets([{ entity_id: "light.kitchen" }])).toEqual([]);
  });
});

describe("sendHANotification", () => {
  beforeEach(() => {
    mocks.callService.mockReset();
    mocks.getHAWebSocketClient.mockReset().mockReturnValue({
      status: "connected",
      callService: mocks.callService,
    });
  });

  it("strips the notify. prefix and calls call_service with title/message/data", async () => {
    mocks.callService.mockResolvedValue(null);

    await sendHANotification("notify.mobile_app_jefferys_iphone", "Hello", "World", {
      push: { sound: "default" },
    });

    expect(mocks.callService).toHaveBeenCalledWith("notify", "mobile_app_jefferys_iphone", {
      title: "Hello",
      message: "World",
      push: { sound: "default" },
    });
  });

  it("accepts a bare service name without the notify. prefix", async () => {
    mocks.callService.mockResolvedValue(null);

    await sendHANotification("mobile_app_zoes_phone", "T", "M");

    expect(mocks.callService).toHaveBeenCalledWith("notify", "mobile_app_zoes_phone", {
      title: "T",
      message: "M",
    });
  });

  it("propagates rejection when HA rejects the call", async () => {
    mocks.callService.mockRejectedValue(new Error("Not connected"));
    await expect(sendHANotification("mobile_app_x", "T", "M")).rejects.toThrow("Not connected");
  });
});

describe("broadcastHouseAlert", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "12345");
    mocks.callService.mockReset();
    mocks.sendTelegramMessage.mockReset();
    mocks.withAdmin.mockReset();
    mocks.getHAWebSocketClient.mockReset().mockReturnValue({
      status: "connected",
      callService: mocks.callService,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.warn).mockClear();
  });

  function mockConfig(rows: Array<{ target: string; enabled: boolean }>) {
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: async () => rows.map((r, i) => ({ id: String(i), ...r, channel: "ha" })),
        }),
      })
    );
  }

  it("counts mixed success/failure across HA and Telegram channels", async () => {
    mockConfig([
      { target: "mobile_app_ok", enabled: true },
      { target: "mobile_app_bad", enabled: true },
    ]);
    mocks.callService.mockImplementation(async (_d: string, service: string) => {
      if (service === "mobile_app_bad") throw new Error("device off");
    });
    mocks.sendTelegramMessage.mockResolvedValue({ success: true });

    const result = await broadcastHouseAlert("Alert", "Body");

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("mobile_app_bad: device off");
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith("12345", "Alert\nBody");
  });

  it("counts a Telegram {success:false} result as failed, not delivered", async () => {
    mockConfig([{ target: "mobile_app_ok", enabled: true }]);
    mocks.callService.mockResolvedValue(null);
    mocks.sendTelegramMessage.mockResolvedValue({
      success: false,
      error: "Bad Request: chat not found",
    });

    const result = await broadcastHouseAlert("Fire", "Kitchen");

    // HA push went out; the Telegram leg must NOT be reported as delivered.
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.notes.some((n: string) => n.includes("telegram") && n.includes("chat not found"))).toBe(true);
  });

  it("never throws even when every channel fails", async () => {
    mockConfig([{ target: "mobile_app_x", enabled: true }]);
    mocks.callService.mockRejectedValue({ message: undefined });
    mocks.sendTelegramMessage.mockRejectedValue(new Error("telegram down"));

    const result = await broadcastHouseAlert("A", "B");

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
  });

  it("skips disabled targets and omits telegram when chat id unset", async () => {
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "");
    mockConfig([{ target: "mobile_app_on", enabled: true }, { target: "mobile_app_off", enabled: false }]);
    mocks.callService.mockResolvedValue(null);

    const result = await broadcastHouseAlert("A", "B");

    expect(mocks.callService).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
  });

  it("treats a PB failure as zero config rows but still sends telegram", async () => {
    mocks.withAdmin.mockRejectedValue(new Error("PB down"));
    mocks.sendTelegramMessage.mockResolvedValue({ success: true });

    const result = await broadcastHouseAlert("A", "B");

    expect(result.sent).toBe(1);
    expect(result.notes.join(" ")).toContain("config read failed");
  });
});

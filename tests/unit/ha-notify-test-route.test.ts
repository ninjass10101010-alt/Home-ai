import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
  sendHANotification: vi.fn(),
}));

vi.mock("@/lib/free-communication", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock("@/lib/ha/notify", () => ({
  sendHANotification: mocks.sendHANotification,
}));

import { POST } from "@/app/api/ha/notify-test/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/ha/notify-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.sendTelegramMessage.mockReset();
  mocks.sendHANotification.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ha/notify-test", () => {
  it("reports failure when the Telegram send returns success:false", async () => {
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "12345");
    mocks.sendTelegramMessage.mockResolvedValue({ success: false, error: "Unauthorized" });

    const res = await POST(req({ channel: "telegram" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unauthorized");
  });

  it("reports ok when the Telegram send succeeds", async () => {
    vi.stubEnv("TELEGRAM_ALERT_CHAT_ID", "12345");
    mocks.sendTelegramMessage.mockResolvedValue({ success: true });

    const res = await POST(req({ channel: "telegram" }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

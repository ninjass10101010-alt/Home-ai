import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

const getServiceConfig = vi.fn();
vi.mock("@/lib/services/config", () => ({ getServiceConfig: (...a: unknown[]) => getServiceConfig(...a) }));

const rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = [];
const del = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: unknown) => unknown) =>
    fn({
      collection: () => ({
        getFullList: async () => rows,
        delete: (...a: unknown[]) => del(...a),
      }),
    }),
}));

import { pushFanout } from "@/lib/push/fanout";

beforeEach(() => {
  sendNotification.mockReset();
  del.mockClear();
  rows.length = 0;
  getServiceConfig.mockReset();
});

describe("pushFanout", () => {
  it("skips cleanly when VAPID is not configured", async () => {
    getServiceConfig.mockResolvedValue(null);
    const r = await pushFanout({ title: "t", body: "b" });
    expect(r.skipped).toBe("push_not_configured");
    expect(r.sent).toBe(0);
  });

  it("sends to every subscription", async () => {
    getServiceConfig.mockImplementation(async (_s: string, k: string) => (k === "VAPID_PUBLIC_KEY" ? "pub" : "priv"));
    rows.push({ id: "1", endpoint: "https://e/1", p256dh: "p", auth: "a" });
    rows.push({ id: "2", endpoint: "https://e/2", p256dh: "p", auth: "a" });
    sendNotification.mockResolvedValue(undefined);
    const r = await pushFanout({ title: "Dinner", body: "in 30 min", url: "/calendar" });
    expect(r.sent).toBe(2);
    expect(r.pruned).toBe(0);
  });

  it("prunes dead subscriptions (410)", async () => {
    getServiceConfig.mockImplementation(async (_s: string, k: string) => (k === "VAPID_PUBLIC_KEY" ? "pub" : "priv"));
    rows.push({ id: "dead", endpoint: "https://e/dead", p256dh: "p", auth: "a" });
    sendNotification.mockRejectedValue({ statusCode: 410 });
    const r = await pushFanout({ title: "t", body: "b" });
    expect(r.pruned).toBe(1);
    expect(del).toHaveBeenCalledWith("dead");
  });

  it("counts non-410 failures without throwing", async () => {
    getServiceConfig.mockImplementation(async (_s: string, k: string) => (k === "VAPID_PUBLIC_KEY" ? "pub" : "priv"));
    rows.push({ id: "x", endpoint: "https://e/x", p256dh: "p", auth: "a" });
    sendNotification.mockRejectedValue({ statusCode: 500 });
    const r = await pushFanout({ title: "t", body: "b" });
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(0);
  });
});
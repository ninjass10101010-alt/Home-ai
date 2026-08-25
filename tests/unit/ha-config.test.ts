import { vi, expect } from "vitest";

vi.mock("@/lib/pb-auth", () => ({ withAdmin: async () => [] }));

const { getHAConfig } = await import("../../src/lib/ha/config");

test("config requires HA_HOST and HA_TOKEN", async () => {
  process.env.HA_HOST = "";
  await expect(getHAConfig()).rejects.toThrow("HA_HOST required");
});

test("config requires HA_TOKEN even when HA_HOST set", async () => {
  process.env.HA_HOST = "http://homeassistant:8123";
  process.env.HA_TOKEN = "";
  await expect(getHAConfig()).rejects.toThrow("HA_TOKEN required");
});

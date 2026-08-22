import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callService: vi.fn(),
  getHAWebSocketClient: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: mocks.getHAWebSocketClient,
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import {
  getTool,
  buildToolsForOpenAI,
} from "../../src/lib/hermes-tools";

const PB_ROWS = [
  { entity_id: "light.kitchen", domain: "light", object_id: "kitchen", friendly_name: "Kitchen", state: "on" },
  { entity_id: "alarm_control_panel.alarm", domain: "alarm_control_panel", object_id: "alarm", friendly_name: "Alarm", state: "disarmed" },
  { entity_id: "lock.front_door", domain: "lock", object_id: "front_door", friendly_name: "Front door", state: "locked" },
  { entity_id: "vacuum.yeedi", domain: "vacuum", object_id: "yeedi", friendly_name: "Yeedi", state: "docked" },
];

function mockPB() {
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({ getFullList: async () => PB_ROWS }),
    })
  );
}

describe("ha house-control tools", () => {
  beforeEach(() => {
    mocks.callService.mockReset().mockResolvedValue(null);
    mocks.getHAWebSocketClient.mockReset().mockReturnValue({
      status: "connected",
      callService: mocks.callService,
    });
    mockPB();
  });

  describe("ha_list_devices", () => {
    it("lists only allowlisted domains with names and states", async () => {
      const tool = getTool("ha_list_devices");
      expect(tool).toBeTruthy();
      const out = JSON.parse(await tool!.handler({}));
      const ids = out.map((d: any) => d.entity_id);
      expect(ids).toContain("light.kitchen");
      expect(ids).toContain("vacuum.yeedi");
      expect(ids).not.toContain("alarm_control_panel.alarm");
      expect(ids).not.toContain("lock.front_door");
    });

    it("filters by an allowed domain argument and reports unavailable on PB failure", async () => {
      const tool = getTool("ha_list_devices")!;
      const out = JSON.parse(await tool.handler({ domain: "vacuum" }));
      expect(out.map((d: any) => d.entity_id)).toEqual(["vacuum.yeedi"]);

      mocks.withAdmin.mockRejectedValue(new Error("PB down"));
      const unavailable = await tool.handler({});
      expect(unavailable).toContain("unavailable");
    });
  });

  describe("ha_control_device", () => {
    const handler = () => getTool("ha_control_device")!.handler;

    it("rejects alarm panels and locks outright", async () => {
      expect(await handler()({ entity_id: "alarm_control_panel.alarm", action: "disarm" })).toContain("not allowed");
      expect(await handler()({ entity_id: "lock.front_door", action: "unlock" })).toContain("not allowed");
      expect(mocks.callService).not.toHaveBeenCalled();
    });

    it("toggles a light via call_service and confirms warmly", async () => {
      const out = await handler()({ entity_id: "light.kitchen", action: "toggle" });
      expect(mocks.callService).toHaveBeenCalledWith("light", "toggle", { entity_id: "light.kitchen" });
      expect(out).toContain("✅");
      expect(out).toContain("Kitchen");
    });

    it("starts the vacuum", async () => {
      const out = await handler()({ entity_id: "vacuum.yeedi", action: "start" });
      expect(mocks.callService).toHaveBeenCalledWith("vacuum", "start", { entity_id: "vacuum.yeedi" });
      expect(out).toContain("✅");
    });

    it("requires a numeric temperature for set_temperature", async () => {
      const bad = await handler()({ entity_id: "climate.living_room", action: "set_temperature" });
      expect(bad).toContain("temperature");
      expect(mocks.callService).not.toHaveBeenCalled();

      await handler()({ entity_id: "climate.living_room", action: "set_temperature", value: 21 });
      expect(mocks.callService).toHaveBeenCalledWith("climate", "set_temperature", {
        entity_id: "climate.living_room",
        temperature: 21,
      });
    });

    it("bounds volume_set between 0 and 1", async () => {
      const bad = await handler()({ entity_id: "media_player.speaker", action: "volume_set", value: 1.5 });
      expect(bad).toMatch(/volume/i);
      expect(mocks.callService).not.toHaveBeenCalled();

      await handler()({ entity_id: "media_player.speaker", action: "volume_set", value: 0.5 });
      expect(mocks.callService).toHaveBeenCalledWith("media_player", "volume_set", {
        entity_id: "media_player.speaker",
        volume_level: 0.5,
      });
    });

    it("rejects actions that do not fit the domain", async () => {
      const out = await handler()({ entity_id: "light.kitchen", action: "start" });
      expect(out).toContain("❌");
      expect(mocks.callService).not.toHaveBeenCalled();
    });

    it("reports HA failures without throwing", async () => {
      mocks.callService.mockRejectedValue(new Error("Not connected"));
      const out = await handler()({ entity_id: "light.kitchen", action: "turn_off" });
      expect(out).toContain("didn't respond");
    });
  });

  describe("buildToolsForOpenAI gating", () => {
    it("includes house tools by default and excludes them when disabled", () => {
      const names = (opts?: { houseControl?: boolean }) =>
        buildToolsForOpenAI(opts).map((t) => t.function.name);

      expect(names()).toContain("ha_control_device");
      expect(names()).toContain("ha_list_devices");
      expect(names({ houseControl: false })).not.toContain("ha_control_device");
      expect(names({ houseControl: false })).not.toContain("ha_list_devices");
      expect(names({ houseControl: false })).toContain("get_weather");
    });
  });
});

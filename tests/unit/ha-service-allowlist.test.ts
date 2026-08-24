import { describe, it, expect } from "vitest";
import {
  isHAServiceAllowed,
  HA_ROUTE_ALLOWED_SERVICES,
} from "../../src/lib/ha/service-allowlist";

describe("HA route service allowlist", () => {
  it("exposes exactly the domains the House tab UI controls", () => {
    expect([...HA_ROUTE_ALLOWED_SERVICES.keys()].sort()).toEqual([
      "climate",
      "light",
      "switch",
      "vacuum",
    ]);
  });

  it("allows every (domain, service) pair the House tab components send", () => {
    const uiPairs: Array<[string, string]> = [
      ["light", "toggle"],
      ["light", "turn_on"],
      ["light", "turn_off"],
      ["switch", "toggle"],
      ["switch", "turn_on"],
      ["switch", "turn_off"],
      ["climate", "set_temperature"],
      ["climate", "set_hvac_mode"],
      ["vacuum", "start"],
      ["vacuum", "pause"],
      ["vacuum", "stop"],
      ["vacuum", "return_to_base"],
    ];

    for (const [domain, service] of uiPairs) {
      expect(isHAServiceAllowed(domain, service)).toBe(true);
    }
  });

  it("never allows alarm control through the general route — it is PIN-gated via /api/ha/alarm", () => {
    const blockedPairs: Array<[string, string]> = [
      ["script", "turn_on"],
      ["automation", "trigger"],
      ["shell_command", "anything"],
      ["notify", "mobile_app_phone"],
      ["cover", "open_cover"],
      ["input_boolean", "toggle"],
      ["scene", "turn_on"],
      ["media_player", "volume_set"],
      ["alarm_control_panel", "alarm_arm_away"],
      ["alarm_control_panel", "alarm_trigger"],
      ["alarm_control_panel", "alarm_arm_home"],
      ["alarm_control_panel", "alarm_disarm"],
    ];

    for (const [domain, service] of blockedPairs) {
      expect(isHAServiceAllowed(domain, service), `${domain}.${service}`).toBe(false);
    }
  });

  it("rejects any service not explicitly listed for an allowed domain", () => {
    expect(isHAServiceAllowed("climate", "set_fan_mode")).toBe(false);
    expect(isHAServiceAllowed("vacuum", "locate")).toBe(false);
  });

  it("rejects unknown domains entirely", () => {
    expect(isHAServiceAllowed("weather", "get_forecasts")).toBe(false);
    expect(isHAServiceAllowed("", "toggle")).toBe(false);
  });
});

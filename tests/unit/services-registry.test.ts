import { describe, it, expect } from "vitest";
import {
  SERVICES_REGISTRY,
  BOOT_EXCLUDED_KEYS,
  isRegistryPair,
  isSecretPair,
  getServiceDef,
} from "../../src/lib/services/registry";
import { COLLECTIONS } from "../../src/lib/pb-seed";

describe("services registry", () => {
  it("contains exactly the approved services", () => {
    expect(SERVICES_REGISTRY.map((s) => s.id).sort()).toEqual(
      [
        "composio",
        "gmail_emergency",
        "greenlight",
        "hermes",
        "home_assistant",
        "instacart",
        "khanacademy",
        "telegram_alert",
        "telegram_mirror",
        "themealdb",
        "weather_location",
      ].sort()
    );
  });

  it("marks secret fields correctly per the spec", () => {
    const secretPairs: Array<[string, string]> = [
      ["home_assistant", "HA_TOKEN"],
      ["home_assistant", "MQTT_PASS"],
      ["telegram_alert", "TELEGRAM_BOT_TOKEN"],
      ["telegram_mirror", "TELEGRAM_MIRROR_BOT_TOKEN"],
      ["gmail_emergency", "GMAIL_APP_PASSWORD"],
      ["hermes", "HERMES_API_KEY"],
      ["instacart", "INSTACART_API_KEY"],
      ["composio", "COMPOSIO_API_KEY"],
      ["greenlight", "GREENLIGHT_API_KEY"],
      ["khanacademy", "KHAN_API_KEY"],
    ];
    for (const [s, k] of secretPairs) {
      expect(isSecretPair(s, k), `${s}.${k}`).toBe(true);
    }

    const plainPairs: Array<[string, string]> = [
      ["home_assistant", "HA_HOST"],
      ["telegram_alert", "TELEGRAM_ALERT_CHAT_ID"],
      ["themealdb", "MEALDB_KEY"],
      ["weather_location", "LAT"],
    ];
    for (const [s, k] of plainPairs) {
      expect(isSecretPair(s, k), `${s}.${k}`).toBe(false);
    }
  });

  it("rejects unknown pairs and ALL boot-critical keys", () => {
    expect(isRegistryPair("nope", "KEY")).toBe(false);
    expect(isRegistryPair("home_assistant", "NOT_A_FIELD")).toBe(false);
    for (const bootKey of BOOT_EXCLUDED_KEYS) {
      for (const svc of SERVICES_REGISTRY.map((s) => s.id)) {
        expect(isRegistryPair(svc, bootKey), `${svc}/${bootKey}`).toBe(false);
      }
    }
  });

  it("gives every field a label and helpText; weather LAT/LON are publicRuntime", () => {
    for (const svc of SERVICES_REGISTRY) {
      for (const f of svc.fields) {
        expect(f.label.length, `${svc.id}.${f.key} label`).toBeGreaterThan(0);
        expect(f.helpText.length, `${svc.id}.${f.key} helpText`).toBeGreaterThan(0);
      }
    }
    const lat = getServiceDef("weather_location")!.fields.find((f) => f.key === "LAT")!;
    expect(lat.publicRuntime).toBe(true);
  });
});

describe("consuela_service_config collection seed", () => {
  it("is seeded with LOCKED rules and a unique (service,key) index", () => {
    const def = COLLECTIONS.find((c) => c.name === "consuela_service_config");
    expect(def).toBeTruthy();
    // LOCKED_RULES = all five null (asserted globally by pb-rules-lockdown)
    expect(def!.indexes!.join("\n")).toContain("UNIQUE INDEX");
    expect(def!.indexes!.join("\n")).toContain("(service, key)");
    const fieldNames = def!.schema.map((f: any) => f.name);
    for (const f of ["service", "key", "value", "is_secret", "updated_at", "updated_by"]) {
      expect(fieldNames).toContain(f);
    }
  });
});

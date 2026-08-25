import { getServiceConfig } from "@/lib/services/config";

export type HAConfig = { haHost: string; haToken: string; mqttBroker?: string; mqttUser?: string; mqttPass?: string };

export async function getHAConfig(): Promise<HAConfig> {
  const host = (await getServiceConfig("home_assistant", "HA_HOST")) || process.env.HA_HOST;
  const token = (await getServiceConfig("home_assistant", "HA_TOKEN")) || process.env.HA_TOKEN;
  if (!host) throw new Error("HA_HOST required");
  if (!token) throw new Error("HA_TOKEN required");
  return {
    haHost: host,
    haToken: token,
    mqttBroker: (await getServiceConfig("home_assistant", "MQTT_BROKER")) || process.env.MQTT_BROKER || undefined,
    mqttUser: (await getServiceConfig("home_assistant", "MQTT_USER")) || process.env.MQTT_USER || undefined,
    mqttPass: (await getServiceConfig("home_assistant", "MQTT_PASS")) || process.env.MQTT_PASS || undefined,
  };
}

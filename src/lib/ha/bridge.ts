import { getHAWebSocketClient, HAStateChange } from "./websocket-client";
import { getHAMQTTClient } from "../mqtt/client";
import { upsertHAEntity, HAEntityRecord } from "./persist";

export interface HABridgeStatus {
  started: boolean;
  wsConnected: boolean;
  mqttStatus: string;
  lastEventAt: string | null;
}

let started = false;
let lastEventAt: string | null = null;

const MQTT_STATE_KEYS = [
  "state",
  "occupancy",
  "temperature",
  "humidity",
  "battery",
  "illuminance",
  "on",
];

function mapWSChange(change: HAStateChange): HAEntityRecord | null {
  const ns = change.new_state;
  if (!ns || typeof ns !== "object" || typeof ns.entity_id !== "string") return null;
  const [domain, ...rest] = ns.entity_id.split(".");
  const attributes: Record<string, unknown> =
    ns.attributes && typeof ns.attributes === "object" ? ns.attributes : {};
  return {
    entity_id: ns.entity_id,
    domain: domain ?? "",
    object_id: rest.join("."),
    friendly_name:
      typeof attributes.friendly_name === "string" ? attributes.friendly_name : "",
    area_id: typeof attributes.area_id === "string" ? attributes.area_id : "",
    state: typeof ns.state === "string" ? ns.state : String(ns.state ?? ""),
    attributes,
    last_updated:
      typeof ns.last_updated === "string" ? ns.last_updated : new Date().toISOString(),
    source: "ha",
  };
}

function mapMqttMessage(msg: {
  topic: string;
  payload: unknown;
}): HAEntityRecord | null {
  const topic = msg.topic;
  if (!topic.startsWith("zigbee2mqtt/")) return null;
  if (topic === "zigbee2mqtt/bridge/state") return null;

  const slug = topic
    .slice("zigbee2mqtt/".length)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");

  const payload: Record<string, unknown> =
    msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.payload)
      ? (msg.payload as Record<string, unknown>)
      : {};

  let state = "";
  for (const key of MQTT_STATE_KEYS) {
    if (payload[key] !== undefined && payload[key] !== null) {
      state = String(payload[key]);
      break;
    }
  }

  return {
    entity_id: `sensor.z2m_${slug}`,
    domain: "sensor",
    object_id: `z2m_${slug}`,
    friendly_name: "",
    area_id: "",
    state,
    attributes: payload,
    last_updated: new Date().toISOString(),
    source: "mqtt",
  };
}

export function startHABridge(): void {
  if (started) return;
  if (!process.env.HA_HOST || !process.env.HA_TOKEN) return;
  started = true;

  const ws = getHAWebSocketClient();
  ws.onStateChange((change) => {
    lastEventAt = new Date().toISOString();
    const record = mapWSChange(change);
    if (!record) return;
    upsertHAEntity(record).catch(() => {});
  });
  ws.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[ha] WS connect failed", message);
  });

  if (process.env.MQTT_BROKER) {
    const mqtt = getHAMQTTClient();
    mqtt.onDeviceMessage((msg) => {
      lastEventAt = new Date().toISOString();
      const record = mapMqttMessage(msg);
      if (!record) return;
      upsertHAEntity(record).catch(() => {});
    });
    mqtt.start();
  }
}

export function getHABridgeStatus(): HABridgeStatus {
  if (!started) {
    return {
      started: false,
      wsConnected: false,
      mqttStatus: "disabled",
      lastEventAt,
    };
  }
  const ws = getHAWebSocketClient();
  const mqtt = process.env.MQTT_BROKER ? getHAMQTTClient() : null;
  return {
    started: true,
    wsConnected: ws.status === "connected",
    mqttStatus: mqtt ? mqtt.status : "disabled",
    lastEventAt,
  };
}

import { HAWebSocketClient, HAStateChange, resetHAWebSocketClient } from "./websocket-client";
import { HAMQTTClient, resetHAMQTTClient } from "../mqtt/client";
import { getHAConfig } from "./config";
import { deleteHAEntity, upsertHAEntity, HAEntityRecord } from "./persist";

export interface HABridgeStatus {
  started: boolean;
  wsConnected: boolean;
  mqttStatus: string;
  lastEventAt: string | null;
}

interface HABridgeState {
  started: boolean;
  lastEventAt: string | null;
  wsClient: HAWebSocketClient | null;
  mqttClient: HAMQTTClient | null;
}

const gBridge = globalThis as unknown as {
  __consuelaHABridge?: HABridgeState;
};

function createBridgeState(): HABridgeState {
  return {
    started: false,
    lastEventAt: null,
    wsClient: null,
    mqttClient: null,
  };
}

// Keep bridge singleton on globalThis so Next.js instrumentation and route
// chunks share state; reinitialize on Vitest module resets.
if (process.env.VITEST || !gBridge.__consuelaHABridge) {
  gBridge.__consuelaHABridge = createBridgeState();
}

function getBridgeState(): HABridgeState {
  if (!gBridge.__consuelaHABridge) {
    gBridge.__consuelaHABridge = createBridgeState();
  }
  return gBridge.__consuelaHABridge;
}

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

export async function startHABridge(): Promise<void> {
  const state = getBridgeState();
  if (state.started) return;
  let cfg;
  try {
    cfg = await getHAConfig();
  } catch {
    return; // not configured — bridge stays off, House tab shows empty states
  }
  state.started = true;

  const ws = new HAWebSocketClient(cfg);
  state.wsClient = ws;
  ws.onStateChange((change) => {
    state.lastEventAt = new Date().toISOString();
    // HA sends new_state: null when an entity is removed — delete the cached
    // row instead of skipping, otherwise removed devices linger as ghosts.
    if (change.new_state === null || change.new_state === undefined) {
      if (typeof change.entity_id === "string" && change.entity_id.length > 0) {
        deleteHAEntity(change.entity_id).catch(() => {});
      }
      return;
    }
    const record = mapWSChange(change);
    if (!record) return;
    upsertHAEntity(record).catch(() => {});
  });
  ws.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[ha] WS connect failed", message);
  });

  if (cfg.mqttBroker) {
    const mqtt = new HAMQTTClient(cfg);
    state.mqttClient = mqtt;
    mqtt.onDeviceMessage((msg) => {
      state.lastEventAt = new Date().toISOString();
      const record = mapMqttMessage(msg);
      if (!record) return;
      upsertHAEntity(record).catch(() => {});
    });
    mqtt.start();
  }
}

export function getHABridgeStatus(): HABridgeStatus {
  const state = getBridgeState();
  if (!state.started) {
    return {
      started: false,
      wsConnected: false,
      mqttStatus: "disabled",
      lastEventAt: state.lastEventAt,
    };
  }
  return {
    started: true,
    wsConnected: state.wsClient?.status === "connected",
    mqttStatus: state.mqttClient ? state.mqttClient.status : "disabled",
    lastEventAt: state.lastEventAt,
  };
}

/** Reconnect support for Services & Keys: stop the bridge and drop the
 * singleton clients so a fresh startHABridge() re-reads config. The
 * control-path singletons (getHAWebSocketClient/getHAMQTTClient used by
 * call-service/alarm/notify/todo-mirror) are reset too — otherwise they keep
 * serving the OLD credentials after rotation. */
export async function resetHABridge(): Promise<void> {
  const state = getBridgeState();
  try {
    await state.wsClient?.close();
  } catch {
    /* already closed */
  }
  try {
    state.mqttClient?.stop?.();
  } catch {
    /* mqtt optional */
  }
  state.wsClient = null;
  state.mqttClient = null;
  state.started = false;
  // Control path: drop singletons BEFORE the next startHABridge()/getter so
  // every consumer rebuilds from the freshly saved config.
  resetHAWebSocketClient();
  resetHAMQTTClient();
}

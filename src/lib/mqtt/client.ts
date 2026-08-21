import { getHAConfig, HAConfig } from "../ha/config";
import { connect, MqttClient, IClientOptions } from "mqtt";

export type MQTTStatus = "disabled" | "connecting" | "connected" | "disconnected";

export interface DeviceMessage {
  topic: string;
  payload: unknown;
  receivedAt: string;
}

export type DeviceMessageHandler = (msg: DeviceMessage) => void;

const SUB_TOPIC = "zigbee2mqtt/#";
const BRIDGE_STATE_TOPIC = "zigbee2mqtt/bridge/state";

export class HAMQTTClient {
  private config: HAConfig;
  private connectFactory: (url: string, opts: IClientOptions) => MqttClient;
  private client: MqttClient | null = null;
  private handlers = new Set<DeviceMessageHandler>();
  private _status: MQTTStatus = "disconnected";

  constructor(
    config?: HAConfig,
    connectFactory?: (url: string, opts: IClientOptions) => MqttClient
  ) {
    this.config = config ?? getHAConfig();
    this.connectFactory = connectFactory ?? ((url, opts) => connect(url, opts));
  }

  get status(): MQTTStatus {
    return this._status;
  }

  start(): void {
    const broker = this.config.mqttBroker;
    if (!broker) {
      this._status = "disabled";
      return;
    }
    if (this.client) return;

    this._status = "connecting";
    const client = this.connectFactory(broker, {
      username: this.config.mqttUser || undefined,
      password: this.config.mqttPass || undefined,
      reconnectPeriod: 5000,
      keepalive: 30,
    });
    this.client = client;

    client.on("connect", () => {
      this._status = "connected";
      client.subscribe(SUB_TOPIC);
    });
    client.on("message", (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload);
    });
    client.on("close", () => {
      this._status = "disconnected";
    });
    client.on("offline", () => {
      this._status = "disconnected";
    });
    client.on("error", () => {
      this._status = "disconnected";
    });
  }

  onDeviceMessage(handler: DeviceMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  stop(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.handlers.clear();
    this._status = "disconnected";
  }

  private handleMessage(topic: string, payload: Buffer): void {
    if (!topic.startsWith("zigbee2mqtt/")) return;
    if (topic === BRIDGE_STATE_TOPIC) return;
    if (topic.endsWith("/availability")) return;
    // Command/echo sub-topics are not device state — publishing them would
    // create synthetic noise entities like sensor.z2m_kitchen_set.
    if (topic.endsWith("/set") || topic.endsWith("/get")) return;

    const raw = payload.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    const msg: DeviceMessage = {
      topic,
      payload: parsed,
      receivedAt: new Date().toISOString(),
    };
    for (const handler of this.handlers) {
      try {
        handler(msg);
      } catch {
        // one throwing handler must not break the others
      }
    }
  }
}

let singleton: HAMQTTClient | null = null;

export function getHAMQTTClient(): HAMQTTClient {
  if (!singleton) {
    singleton = new HAMQTTClient(getHAConfig());
  }
  return singleton;
}

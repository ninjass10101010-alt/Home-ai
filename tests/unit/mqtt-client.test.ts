import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/pb-auth", () => ({ withAdmin: async (fn: any) => fn({ collection: () => ({ getFullList: async () => [] }) }) }));
import {
  HAMQTTClient,
  getHAMQTTClient,
  resetHAMQTTClient,
  DeviceMessage,
} from "../../src/lib/mqtt/client";
import type { MqttClient, IClientOptions } from "mqtt";

class FakeMqttClient {
  listeners: Record<string, Array<(...args: never[]) => void>> = {};
  subscribed: string[] = [];
  ended = false;
  endForce: boolean | undefined = undefined;

  on(event: string, cb: (...args: never[]) => void): this {
    (this.listeners[event] ??= []).push(cb);
    return this;
  }

  subscribe(topic: string): this {
    this.subscribed.push(topic);
    return this;
  }

  end(force?: boolean): this {
    this.ended = true;
    this.endForce = force;
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}

function makeHarness(config?: {
  mqttBroker?: string;
  mqttUser?: string;
  mqttPass?: string;
}) {
  const fakes: FakeMqttClient[] = [];
  const factory = vi.fn(
    (_url: string, _opts: IClientOptions): MqttClient => {
      const fake = new FakeMqttClient();
      fakes.push(fake);
      return fake as unknown as MqttClient;
    }
  );
  const client = new HAMQTTClient(
    {
      haHost: "http://homeassistant:8123",
      haToken: "test-token",
      ...config,
    },
    factory
  );
  return { client, factory, fakes };
}

function connect(fake: FakeMqttClient): void {
  fake.emit("connect");
}

describe("HAMQTTClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start() with no broker configured leaves status disabled and never connects", () => {
    const { client, factory } = makeHarness();

    client.start();

    expect(client.status).toBe("disabled");
    expect(factory).not.toHaveBeenCalled();
  });

  it("start() connects with broker url + credentials and subscribes zigbee2mqtt/# on connect", () => {
    const { client, factory, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
      mqttUser: "consuela",
      mqttPass: "s3cret",
    });

    client.start();
    expect(client.status).toBe("connecting");
    expect(factory).toHaveBeenCalledWith("mqtt://zigbee.local:1883", {
      username: "consuela",
      password: "s3cret",
      reconnectPeriod: 5000,
      keepalive: 30,
    });

    const fake = fakes[0];
    connect(fake);

    expect(client.status).toBe("connected");
    expect(fake.subscribed).toContain("zigbee2mqtt/#");
  });

  it("start() is idempotent — repeated calls connect only once", () => {
    const { client, factory, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });

    client.start();
    connect(fakes[0]);
    client.start();
    client.start();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.status).toBe("connected");
  });

  it("dispatches parsed JSON messages to handlers and unsubscribe stops delivery", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    const unsubscribe = client.onDeviceMessage((msg) => received.push(msg));

    fakes[0].emit(
      "message",
      "zigbee2mqtt/0x1234",
      Buffer.from(JSON.stringify({ temperature: 21.5, battery: 87 }))
    );

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe("zigbee2mqtt/0x1234");
    expect(received[0].payload).toEqual({ temperature: 21.5, battery: 87 });
    expect(new Date(received[0].receivedAt).getTime()).not.toBeNaN();

    unsubscribe();
    fakes[0].emit(
      "message",
      "zigbee2mqtt/0x1234",
      Buffer.from(JSON.stringify({ temperature: 22 }))
    );

    expect(received).toHaveLength(1);
  });

  it("passes non-JSON payloads through as the raw string", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    client.onDeviceMessage((msg) => received.push(msg));

    fakes[0].emit("message", "zigbee2mqtt/0x1234", Buffer.from("not-json"));

    expect(received).toHaveLength(1);
    expect(received[0].payload).toBe("not-json");
  });

  it("ignores messages on zigbee2mqtt/bridge/state", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    client.onDeviceMessage((msg) => received.push(msg));

    fakes[0].emit("message", "zigbee2mqtt/bridge/state", Buffer.from("online"));

    expect(received).toHaveLength(0);
  });

  it("ignores /set and /get command sub-topics", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    client.onDeviceMessage((msg) => received.push(msg));

    fakes[0].emit(
      "message",
      "zigbee2mqtt/kitchen/set",
      Buffer.from(JSON.stringify({ state: "on" }))
    );
    fakes[0].emit(
      "message",
      "zigbee2mqtt/kitchen/get",
      Buffer.from(JSON.stringify({ state: "" }))
    );

    expect(received).toHaveLength(0);
  });

  it("ignores messages on /availability topics", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    client.onDeviceMessage((msg) => received.push(msg));

    fakes[0].emit(
      "message",
      "zigbee2mqtt/0x1234/availability",
      Buffer.from(JSON.stringify({ state: "online" }))
    );

    expect(received).toHaveLength(0);
  });

  it("stop() calls end(true) and sets status disconnected", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);
    const fake = fakes[0];

    client.stop();

    expect(fake.ended).toBe(true);
    expect(fake.endForce).toBe(true);
    expect(client.status).toBe("disconnected");
  });

  it("a throwing handler does not prevent other handlers from receiving the message", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    const received: DeviceMessage[] = [];
    client.onDeviceMessage(() => {
      throw new Error("boom");
    });
    client.onDeviceMessage((msg) => received.push(msg));

    expect(() =>
      fakes[0].emit(
        "message",
        "zigbee2mqtt/0x1234",
        Buffer.from(JSON.stringify({ on: true }))
      )
    ).not.toThrow();

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ on: true });
  });

  it("close and offline events set status disconnected", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);
    const fake = fakes[0];

    fake.emit("offline");
    expect(client.status).toBe("disconnected");

    fake.emit("connect");
    expect(client.status).toBe("connected");

    fake.emit("close");
    expect(client.status).toBe("disconnected");
  });

  it("error events set status disconnected and never throw", () => {
    const { client, fakes } = makeHarness({
      mqttBroker: "mqtt://zigbee.local:1883",
    });
    client.start();
    connect(fakes[0]);

    expect(() => fakes[0].emit("error", new Error("ECONNREFUSED"))).not.toThrow();
    expect(client.status).toBe("disconnected");
  });

  it("getHAMQTTClient returns a HAMQTTClient instance", async () => {
    process.env.HA_HOST = "http://homeassistant:8123";
    process.env.HA_TOKEN = "test-token";
    expect(await getHAMQTTClient()).toBeInstanceOf(HAMQTTClient);
  });

  it("resetHAMQTTClient drops the singleton so the next getter builds a NEW instance", async () => {
    process.env.HA_HOST = "http://homeassistant:8123";
    process.env.HA_TOKEN = "test-token";
    const first = await getHAMQTTClient();
    resetHAMQTTClient();
    expect(await getHAMQTTClient()).not.toBe(first);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  let capturedHandler: ((change: unknown) => void) | null = null;
  let capturedMqttHandler: ((msg: unknown) => void) | null = null;
  return {
    connect: vi.fn(),
    onStateChange: vi.fn((cb: (change: unknown) => void) => {
      capturedHandler = cb;
      return () => {};
    }),
    mqttStart: vi.fn(),
    onDeviceMessage: vi.fn((cb: (msg: unknown) => void) => {
      capturedMqttHandler = cb;
      return () => {};
    }),
    upsertHAEntity: vi.fn(),
    deleteHAEntity: vi.fn(),
    getCapturedHandler: () => capturedHandler,
    getCapturedMqttHandler: () => capturedMqttHandler,
  };
});

vi.mock("../../src/lib/ha/websocket-client", () => ({
  getHAWebSocketClient: () => ({
    status: "connected",
    connect: mocks.connect,
    onStateChange: mocks.onStateChange,
  }),
}));

vi.mock("../../src/lib/mqtt/client", () => ({
  getHAMQTTClient: () => ({
    status: "connected",
    start: mocks.mqttStart,
    onDeviceMessage: mocks.onDeviceMessage,
  }),
}));

vi.mock("../../src/lib/ha/persist", () => ({
  upsertHAEntity: mocks.upsertHAEntity,
  upsertHAEntities: vi.fn(),
  deleteHAEntity: mocks.deleteHAEntity,
}));

type BridgeModule = typeof import("../../src/lib/ha/bridge");

async function loadBridge(): Promise<BridgeModule> {
  return import("../../src/lib/ha/bridge");
}

const wsChange = {
  entity_id: "light.kitchen",
  old_state: null,
  new_state: {
    entity_id: "light.kitchen",
    state: "on",
    attributes: {
      friendly_name: "Kitchen Light",
      area_id: "kitchen",
      brightness: 255,
    },
    last_changed: "2026-08-21T12:00:00Z",
    last_updated: "2026-08-21T12:00:01Z",
  },
};

const z2mMsg = {
  topic: "zigbee2mqtt/Living Room/thermostat",
  payload: { temperature: 21.5, humidity: 40, linkquality: 100 },
  receivedAt: "2026-08-21T12:00:02Z",
};

describe("startHABridge", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue(undefined);
    mocks.onStateChange.mockClear();
    mocks.onDeviceMessage.mockClear();
    mocks.mqttStart.mockReset();
    mocks.upsertHAEntity.mockReset();
    mocks.upsertHAEntity.mockResolvedValue(undefined);
    mocks.deleteHAEntity.mockReset();
    mocks.deleteHAEntity.mockResolvedValue(undefined);
    process.env.HA_HOST = "http://ha.local:8123";
    process.env.HA_TOKEN = "test-token";
    process.env.MQTT_BROKER = "mqtt://broker:1883";
  });

  it("does not connect when HA env is missing", async () => {
    delete process.env.HA_HOST;
    delete process.env.HA_TOKEN;

    const { startHABridge } = await loadBridge();
    startHABridge();

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.mqttStart).not.toHaveBeenCalled();
  });

  it("connects the WS client and persists mapped state changes (source ha)", async () => {
    const { startHABridge } = await loadBridge();
    startHABridge();

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.onStateChange).toHaveBeenCalledTimes(1);

    const handler = mocks.getCapturedHandler();
    expect(handler).toBeTruthy();
    handler!(wsChange);

    expect(mocks.upsertHAEntity).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHAEntity).toHaveBeenCalledWith({
      entity_id: "light.kitchen",
      domain: "light",
      object_id: "kitchen",
      friendly_name: "Kitchen Light",
      area_id: "kitchen",
      state: "on",
      attributes: {
        friendly_name: "Kitchen Light",
        area_id: "kitchen",
        brightness: 255,
      },
      last_updated: "2026-08-21T12:00:01Z",
      source: "ha",
    });
  });

  it("persists MQTT messages as synthetic sensor.z2m_* entities (source mqtt)", async () => {
    const { startHABridge } = await loadBridge();
    startHABridge();

    expect(mocks.mqttStart).toHaveBeenCalledTimes(1);
    expect(mocks.onDeviceMessage).toHaveBeenCalledTimes(1);

    const handler = mocks.getCapturedMqttHandler();
    expect(handler).toBeTruthy();
    handler!(z2mMsg);

    expect(mocks.upsertHAEntity).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHAEntity).toHaveBeenCalledWith({
      entity_id: "sensor.z2m_living_room_thermostat",
      domain: "sensor",
      object_id: "z2m_living_room_thermostat",
      friendly_name: "",
      area_id: "",
      state: "21.5",
      attributes: { temperature: 21.5, humidity: 40, linkquality: 100 },
      last_updated: expect.any(String),
      source: "mqtt",
    });
  });

  it("is idempotent (second call does not reconnect)", async () => {
    const { startHABridge } = await loadBridge();
    startHABridge();
    startHABridge();

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.mqttStart).toHaveBeenCalledTimes(1);
  });

  it("deletes the cached row when HA reports a removed entity (new_state null)", async () => {
    const { startHABridge } = await loadBridge();
    startHABridge();

    const handler = mocks.getCapturedHandler();
    expect(handler).toBeTruthy();
    handler!({
      entity_id: "light.retired",
      old_state: { state: "on" },
      new_state: null,
    });

    expect(mocks.upsertHAEntity).not.toHaveBeenCalled();
    expect(mocks.deleteHAEntity).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHAEntity).toHaveBeenCalledWith("light.retired");
  });

  it("reports bridge status before and after start", async () => {
    const { startHABridge, getHABridgeStatus } = await loadBridge();

    expect(getHABridgeStatus()).toEqual({
      started: false,
      wsConnected: false,
      mqttStatus: "disabled",
      lastEventAt: null,
    });

    startHABridge();

    expect(getHABridgeStatus()).toEqual({
      started: true,
      wsConnected: true,
      mqttStatus: "connected",
      lastEventAt: null,
    });
  });
});

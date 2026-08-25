import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.mock("@/lib/pb-auth", () => ({ withAdmin: async (fn: any) => fn({ collection: () => ({ getFullList: async () => [] }) }) }));
import {
  HAWebSocketClient,
  getHAWebSocketClient,
  WebSocketLike,
} from "../../src/lib/ha/websocket-client";

const HANDSHAKE_TIMEOUT_MS = 15_000;

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: any[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    if (this.onclose) this.onclose();
  }

  emit(msg: any): void {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) });
  }
}

describe("HAWebSocketClient", () => {
  beforeEach(() => {
    process.env.HA_HOST = "http://homeassistant:8123";
    process.env.HA_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFactory() {
    const sockets: FakeSocket[] = [];
    const factory = vi.fn((_url: string) => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    return { sockets, factory };
  }

  function makeClient(
    factory: (url: string) => WebSocketLike,
    token = "test-token"
  ) {
    return new HAWebSocketClient(
      { haHost: "http://homeassistant:8123", haToken: token },
      factory
    );
  }

  async function driveHandshake(socket: FakeSocket) {
    if (socket.onopen) socket.onopen();
    socket.emit({ type: "auth_required", ha_version: "2026.1" });
    const authMsg = socket.sent.find((m) => m.type === "auth");
    socket.emit({ type: "auth_ok", ha_version: "2026.1" });
    const subMsg = socket.sent.find((m) => m.type === "subscribe_events");
    socket.emit({
      type: "result",
      success: true,
      id: subMsg ? subMsg.id : 1,
      result: null,
    });
    return { authMsg, subMsg };
  }

  it("sends auth with the token from config and resolves after auth_ok + subscription result", async () => {
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory, "secret-token");

    expect(client.status).toBe("disconnected");
    const connecting = client.connect();
    expect(client.status).toBe("connecting");

    expect(factory).toHaveBeenCalledWith("ws://homeassistant:8123/api/websocket");
    const socket = sockets[0];

    await driveHandshake(socket);
    await connecting;
    expect(client.status).toBe("connected");

    const authMsg = socket.sent.find((m) => m.type === "auth");
    expect(authMsg).toEqual({ type: "auth", access_token: "secret-token" });
    const subMsg = socket.sent.find((m) => m.type === "subscribe_events");
    expect(subMsg).toMatchObject({
      type: "subscribe_events",
      event_type: "state_changed",
    });
    expect(typeof subMsg.id).toBe("number");
  });

  it("rejects when the server replies auth_invalid", async () => {
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory, "bad-token");

    const connecting = client.connect();
    const socket = sockets[0];
    if (socket.onopen) socket.onopen();
    socket.emit({ type: "auth_required", ha_version: "2026.1" });
    socket.emit({ type: "auth_invalid", message: "Invalid access token" });

    await expect(connecting).rejects.toThrow("Invalid access token");
  });

  it("dispatches state_changed events to handlers and unsubscribe stops delivery", async () => {
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    const { subMsg } = await driveHandshake(sockets[0]);
    await connecting;

    const handler = vi.fn();
    const unsubscribe = client.onStateChange(handler);
    sockets[0].emit({
      type: "event",
      id: subMsg.id,
      event: {
        event_type: "state_changed",
        data: {
          entity_id: "light.kitchen",
          old_state: { state: "off" },
          new_state: { state: "on" },
        },
      },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      entity_id: "light.kitchen",
      old_state: { state: "off" },
      new_state: { state: "on" },
    });

    unsubscribe();
    sockets[0].emit({
      type: "event",
      id: subMsg.id,
      event: {
        event_type: "state_changed",
        data: {
          entity_id: "light.kitchen",
          old_state: { state: "on" },
          new_state: { state: "off" },
        },
      },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("callService sends call_service and resolves with the matching result", async () => {
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    const pending = client.callService("light", "turn_on", {
      entity_id: "light.kitchen",
    });

    const sent = sockets[0].sent.find((m) => m.type === "call_service");
    expect(sent).toEqual({
      type: "call_service",
      domain: "light",
      service: "turn_on",
      service_data: { entity_id: "light.kitchen" },
      id: sent.id,
    });

    sockets[0].emit({
      type: "result",
      success: true,
      id: sent.id,
      result: { ok: true },
    });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("callService rejects after a 10s timeout", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    const pending = client.callService("light", "turn_on", {});
    const expectation = expect(pending).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
  });

  it("reconnects with backoff after an unexpected close post-auth", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    expect(sockets).toHaveLength(1);
    sockets[0].close();
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sockets).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith(
      "ws://homeassistant:8123/api/websocket"
    );
  });

  it("does not reconnect after an explicit close()", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    client.close();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sockets).toHaveLength(1);
  });

  it("handshake timeout rejects, then retries with backoff", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);

    const connecting = client.connect();
    const socket = sockets[0];
    socket.onopen?.();
    socket.emit({ type: "auth_required", ha_version: "2026.1" });
    // Server never answers — no auth_ok.

    const expectation = expect(connecting).rejects.toThrow("handshake timed out");
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS + 100);
    await expectation;

    // Backoff starts at 1s ±20% jitter → second attempt well within 3s.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sockets).toHaveLength(2);
  });

  it("auth_invalid does not schedule any reconnect", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory, "bad-token");

    const connecting = client.connect();
    const socket = sockets[0];
    socket.onopen?.();
    socket.emit({ type: "auth_required", ha_version: "2026.1" });
    socket.emit({ type: "auth_invalid", message: "nope" });

    await expect(connecting).rejects.toThrow("nope");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sockets).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries when the very first handshake fails (HA down at startup)", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);

    const connecting = client.connect();
    const socket = sockets[0];
    // Close before the handshake completes — HA unreachable.
    if (socket.onclose) socket.onclose();

    await expect(connecting).rejects.toThrow("closed during handshake");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sockets).toHaveLength(2);
  });

  it("a pending reconnect timer is cancelled by an explicit close()", async () => {
    vi.useFakeTimers();
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    sockets[0].close(); // unexpected close schedules a reconnect
    client.close(); // explicit close should cancel it

    await vi.advanceTimersByTimeAsync(40_000);
    expect(sockets).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("replies pong to server pings", async () => {
    const { sockets, factory } = makeFactory();
    const client = makeClient(factory);
    const connecting = client.connect();
    await driveHandshake(sockets[0]);
    await connecting;

    sockets[0].emit({ type: "ping", id: 7 });
    expect(sockets[0].sent).toContainEqual({ type: "pong", id: 7 });
  });

  it("getHAWebSocketClient returns the same singleton instance", async () => {
    expect(await getHAWebSocketClient()).toBe(await getHAWebSocketClient());
  });
});

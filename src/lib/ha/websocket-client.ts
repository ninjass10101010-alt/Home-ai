import { getHAConfig, HAConfig } from "./config";

export interface HAStateChange {
  entity_id: string;
  old_state: any;
  new_state: any;
}

export type StateChangeHandler = (change: HAStateChange) => void;
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected";

export interface WebSocketLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  close(): void;
  send(data: string): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SUBSCRIBE_EVENTS = "subscribe_events";
const MAX_BACKOFF_MS = 30_000;
const CALL_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;

export class HAWebSocketClient {
  private readonly config: HAConfig;
  private readonly socketFactory: (url: string) => WebSocketLike;
  private socket: WebSocketLike | null = null;
  private _status: ConnectionStatus = "disconnected";
  private nextId = 1;
  private nextSubId = 1;
  private subscriptionId: number | null = null;
  private pending = new Map<number, PendingCall>();
  private stateHandlers = new Set<StateChangeHandler>();
  private connectPromise: Promise<void> | null = null;
  private backoffMs = 1_000;
  private closedExplicitly = false;
  private authFailed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: HAConfig,
    socketFactory?: (url: string) => WebSocketLike
  ) {
    this.config = config;
    this.socketFactory =
      socketFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  private wsUrl(): string {
    const ws = this.config.haHost
      .replace(/\/+$/, "")
      .replace(/^http:\/\//i, "ws://")
      .replace(/^https:\/\//i, "wss://");
    return `${ws}/api/websocket`;
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    if (this.socket) return Promise.resolve();

    this.closedExplicitly = false;
    this._status = "connecting";

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let opened = false;
      let settled = false;

      const fail = (err: Error, opts?: { retryable?: boolean }) => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        if (this.socket === socket) this.socket = null;
        this._status = "disconnected";
        reject(err);
        // Transient handshake failures (server down, timeout, dropped socket)
        // should keep trying with backoff — HA may simply boot after us. A
        // rejected token must NOT loop; auth_invalid sets authFailed first.
        if (opts?.retryable !== false && !this.closedExplicitly && !this.authFailed) {
          this.scheduleReconnect();
        }
      };

      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        this.connectPromise = null;
        this.backoffMs = 1_000;
        this._status = "connected";
        resolve();
      };

      // Guard against a lost subscription result leaving connect() pending forever.
      // Fail BEFORE closing so onclose sees a nulled socket and doesn't
      // schedule a second (duplicate) reconnect.
      const handshakeTimer = setTimeout(() => {
        fail(new Error("HA WebSocket handshake timed out"));
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
      }, HANDSHAKE_TIMEOUT_MS);

      let socket: WebSocketLike;
      try {
        socket = this.socketFactory(this.wsUrl());
      } catch (err) {
        clearTimeout(handshakeTimer);
        fail(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.socket = socket;

      socket.onopen = () => {
        if (this.socket !== socket) return;
        opened = true;
        this._status = "authenticating";
      };

      socket.onerror = () => {
        if (this.socket !== socket) return;
        if (!opened) {
          clearTimeout(handshakeTimer);
          fail(new Error("WebSocket error during handshake"));
          return;
        }
        this.handleUnexpectedClose(socket);
      };

      socket.onclose = () => {
        if (this.socket !== socket) return;
        if (!opened) {
          clearTimeout(handshakeTimer);
          fail(new Error("WebSocket closed during handshake"));
          return;
        }
        this.handleUnexpectedClose(socket);
      };

      socket.onmessage = (ev) => {
        if (this.socket !== socket) return;
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;

        switch (msg.type) {
          case "auth_required":
            try {
              socket.send(
                JSON.stringify({
                  type: "auth",
                  access_token: this.config.haToken,
                })
              );
            } catch {
              /* ignore */
            }
            return;
          case "auth_ok":
            this.subscriptionId = this.nextSubId++;
            try {
              socket.send(
                JSON.stringify({
                  type: SUBSCRIBE_EVENTS,
                  event_type: "state_changed",
                  id: this.subscriptionId,
                })
              );
            } catch {
              /* ignore */
            }
            return;
          case "auth_invalid":
            // Latch BEFORE closing so the onclose handler can't schedule a
            // retry for a token that will never succeed.
            this.authFailed = true;
            try {
              socket.close();
            } catch {
              /* ignore */
            }
            fail(new Error(`HA auth invalid: ${msg.message ?? "unknown"}`), {
              retryable: false,
            });
            return;
          case "ping":
            try {
              socket.send(JSON.stringify({ type: "pong", id: msg.id }));
            } catch {
              /* ignore */
            }
            return;
          case "pong":
            return;
          case "result":
            if (msg.id === this.subscriptionId && !settled) {
              this.subscriptionId = null;
              done();
              return;
            }
            if (typeof msg.id === "number" && this.pending.has(msg.id)) {
              const call = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              clearTimeout(call.timer);
              if (msg.success === false) {
                call.reject(
                  new Error(
                    `HA service call failed: ${JSON.stringify(msg.error ?? msg)}`
                  )
                );
              } else {
                call.resolve(msg.result);
              }
            }
            return;
          case "event":
            this.dispatchEvent(msg);
            return;
          default:
            return;
        }
      };
    });

    return this.connectPromise;
  }

  private dispatchEvent(msg: any): void {
    try {
      if (msg?.event?.event_type !== "state_changed") return;
      const data = msg.event.data ?? {};
      const change: HAStateChange = {
        entity_id: data.entity_id,
        old_state: data.old_state,
        new_state: data.new_state,
      };
      for (const handler of Array.from(this.stateHandlers)) {
        try {
          handler(change);
        } catch {
          /* ignore handler errors */
        }
      }
    } catch {
      /* ignore malformed events */
    }
  }

  private scheduleReconnect(): void {
    if (this.closedExplicitly || this.authFailed) return;
    const jitter = this.backoffMs * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(this.backoffMs + jitter));
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private handleUnexpectedClose(socket: WebSocketLike): void {
    if (this.closedExplicitly) return;
    if (this.socket !== socket) return;
    this.socket = null;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("WebSocket closed"));
    }
    this.pending.clear();
    this._status = "disconnected";
    this.connectPromise = null;

    // Retry regardless of whether a previous handshake fully succeeded —
    // HA may simply not be up yet. auth_invalid latches via authFailed.
    this.scheduleReconnect();
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closedExplicitly = true;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Client closed"));
    }
    this.pending.clear();
    this.connectPromise = null;
    this._status = "disconnected";
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket) {
      return Promise.reject(new Error("Not connected"));
    }
    const id = this.nextId++;
    const message = JSON.stringify({
      type: "call_service",
      domain,
      service,
      service_data: serviceData ?? {},
      id,
    });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`HA call_service ${domain}.${service} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(message);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

let singleton: HAWebSocketClient | null = null;

export async function getHAWebSocketClient(): Promise<HAWebSocketClient> {
  if (!singleton) {
    singleton = new HAWebSocketClient(await getHAConfig());
  }
  return singleton;
}

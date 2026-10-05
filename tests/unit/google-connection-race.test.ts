// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGoogleConnection } from "@/hooks/useGoogleConnection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(body: Record<string, unknown>, ok = true, status = 200): any {
  return { ok, status, json: async () => body };
}

function disconnectedState() {
  return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
}

function connectedState(email = "family@example.com") {
  return response({ ok: true, connected: true, account_email: email, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
}

function setupPayload(toolkit: "googlecalendar" | "googletasks" = "googlecalendar", expiresInMs = 600_000) {
  return response({
    ok: true,
    toolkit,
    auth_url: toolkit === "googletasks" ? "https://backend.composio.dev/link/tasks" : "https://backend.composio.dev/link/abc",
    connected_account_id: toolkit === "googletasks" ? "ca_tasks" : "ca_1",
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  });
}

function activeStatus(toolkit: "googlecalendar" | "googletasks" = "googlecalendar") {
  return response({ ok: true, connected: true, status: "ACTIVE", toolkit, connected_account_id: toolkit === "googletasks" ? "ca_tasks" : "ca_1", account_email: "family@example.com" });
}

function pendingStatus() {
  return response({ ok: true, connected: false, status: "INITIATED", reason: "account_not_active" });
}

function isStatusUrl(url: string): boolean {
  return url.includes("/api/google/composio/status");
}

let hook: ReturnType<typeof useGoogleConnection>;
const roots: Root[] = [];

function Probe() {
  const current = useGoogleConnection();
  useEffect(() => {
    hook = current;
  }, [current]);
  return createElement("output", { "data-testid": "google-probe", "data-status": current.status }, current.status);
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Probe));
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(0);
    await Promise.resolve();
  });
  return host;
}

async function flush(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useGoogleConnection composio consent flow", () => {
  it("discovers connected state on mount", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) return connectedState();
      return response({ ok: true });
    });
    await mount();

    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("family@example.com");
  });

  it("discovers connected state after explicit hosted-consent completion", async () => {
    let stateReads = 0;
    let statusPolls = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return stateReads > 1 ? connectedState() : disconnectedState();
      }
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (isStatusUrl(url)) {
        if (url.endsWith("toolkit=googletasks")) return activeStatus("googletasks");
        statusPolls += 1;
        return statusPolls === 1 ? pendingStatus() : activeStatus();
      }
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });

    expect(hook.status).toBe("waiting");
    expect(hook.waiting?.auth_url).toBe("https://backend.composio.dev/link/abc");
    expect(hook.waiting?.toolkit).toBe("googlecalendar");
    expect(typeof hook.waiting?.expires_at).toBe("number");

    await flush(5000);
    expect(hook.status).toBe("waiting");

    await flush(5000);
    expect(statusPolls).toBe(2);
    expect(stateReads).toBe(2);
    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("family@example.com");
  });

  it("posts the toolkit and polls the tasks status when connecting tasks", async () => {
    let setupBody: unknown = null;
    let sawTasksStatusUrl = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return connectedState();
      if (url.endsWith("/api/google/composio/setup")) {
        setupBody = JSON.parse(String(init?.body));
        return setupPayload("googletasks");
      }
      if (isStatusUrl(url)) {
        if (url.endsWith("toolkit=googletasks")) sawTasksStatusUrl = true;
        return sawTasksStatusUrl && setupBody !== null ? activeStatus("googletasks") : pendingStatus();
      }
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect("googletasks");
    });
    await flush(5000);

    expect(setupBody).toEqual({ toolkit: "googletasks" });
    expect(sawTasksStatusUrl).toBe(true);
    expect(hook.tasksConnected).toBe(true);
    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("family@example.com");
  });

  it("expires the hosted consent when the link deadline passes without approval", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/setup")) return setupPayload("googlecalendar", 1000);
      if (isStatusUrl(url)) return pendingStatus();
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    expect(hook.status).toBe("error:expired");
    expect(hook.waiting).toBeNull();
  });

  it("treats a missing connected account as expired before the deadline", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (isStatusUrl(url)) {
        return response({ ok: true, connected: false, status: "NOT_FOUND", reason: "account_not_found" });
      }
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    expect(hook.status).toBe("error:expired");
    expect(hook.waiting).toBeNull();
  });

  it("restores the connected calendar after cancelling an optional tasks connect", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return connectedState();
      if (url.endsWith("/api/google/composio/setup")) return setupPayload("googletasks");
      if (isStatusUrl(url)) return pendingStatus();
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect("googletasks");
    });
    await flush(5000);
    expect(hook.status).toBe("waiting");

    act(() => hook.cancel());
    expect(hook.status).toBe("connected");
    expect(hook.waiting).toBeNull();

    await flush(10000);
    expect(hook.status).toBe("connected");
  });

  it("probes the tasks toolkit when calendar is connected", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return connectedState();
      if (isStatusUrl(url)) {
        return url.endsWith("toolkit=googletasks")
          ? activeStatus("googletasks")
          : disconnectedState();
      }
      return response({ ok: true });
    });
    await mount();
    await flush(0);

    expect(hook.tasksConnected).toBe(true);
  });

  it("rejects a malformed 2xx setup body", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/setup")) return response({ ok: true, toolkit: "googlecalendar" });
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });

    expect(hook.status).toBe("error:unknown");
    expect(hook.waiting).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/api/google/composio/setup"))).toBe(true);
  });

  it("rejects a malformed 2xx status body instead of waiting forever", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (isStatusUrl(url)) return response({ ok: true });
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    expect(hook.status).toBe("error:unknown");
    expect(hook.waiting).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => isStatusUrl(String(url)))).toBe(true);
  });

  it("does not let a deferred status poll restore state after cancel", async () => {
    const poll = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return disconnectedState();
      }
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (isStatusUrl(url)) return poll.promise;
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);
    const readsBeforeCancel = stateReads;

    act(() => hook.cancel());
    await act(async () => {
      poll.resolve(activeStatus());
      await Promise.resolve();
    });
    await flush(10000);

    expect(stateReads).toBe(readsBeforeCancel);
    expect(hook.status).toBe("unconnected");
  });

  it("clears the poll timer when unmounted during hosted consent", async () => {
    let statusCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (isStatusUrl(url)) {
        statusCalls += 1;
        return pendingStatus();
      }
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });

    const root = roots.pop();
    if (root) act(() => root.unmount());
    await flush(10000);

    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/api/google/composio/setup"))).toBe(true);
    expect(statusCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a deferred status poll restore state after disconnect", async () => {
    const poll = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return disconnectedState();
      }
      if (url.endsWith("/api/google/composio/setup")) return setupPayload();
      if (url.endsWith("/api/google/composio/disconnect")) {
        return response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
      }
      if (isStatusUrl(url)) return poll.promise;
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    await act(async () => {
      await hook.disconnect();
    });
    const readsAfterDisconnect = stateReads;
    await act(async () => {
      poll.resolve(activeStatus());
      await Promise.resolve();
    });
    await flush(10000);

    expect(stateReads).toBe(readsAfterDisconnect);
    expect(hook.status).toBe("unconnected");
  });

  it("ignores a deferred public refresh after cancel", async () => {
    const pendingState = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        stateReads += 1;
        if (stateReads === 1) return disconnectedState();
        return pendingState.promise;
      }
      return response({ ok: true });
    });
    await mount();

    const refreshPromise = hook.refresh();
    act(() => hook.cancel());
    await act(async () => {
      pendingState.resolve(connectedState());
      await refreshPromise;
    });

    expect(hook.status).toBe("unconnected");
    expect(hook.state?.connected).not.toBe(true);
  });

  it("invalidates a pre-transition refresh and never starts a competing disconnect state read", async () => {
    const pendingState = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        if (stateReads === 1) return connectedState();
        if (stateReads === 2) return pendingState.promise;
        return disconnectedState();
      }
      if (url.endsWith("/api/google/composio/disconnect")) {
        return response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
      }
      return response({ ok: true });
    });
    await mount();

    let refreshPromise!: Promise<boolean>;
    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    await act(async () => {
      refreshPromise = hook.refresh();
      disconnectPromise = hook.disconnect();
    });
    await act(async () => {
      await disconnectPromise;
    });

    expect(stateReads).toBe(2);
    await act(async () => {
      pendingState.resolve(connectedState());
      await refreshPromise;
    });

    expect(hook.status).toBe("unconnected");
    expect(hook.state).toBeNull();
    expect(stateReads).toBe(2);
  });

  it("rejects a post-transition refresh without another state read", async () => {
    const disconnect = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return connectedState();
      }
      if (url.endsWith("/api/google/composio/disconnect")) return disconnect.promise;
      return response({ ok: true });
    });
    await mount();

    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    await act(async () => {
      disconnectPromise = hook.disconnect();
    });
    await act(async () => {
      disconnect.resolve(response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true }));
      await disconnectPromise;
    });
    let refreshed!: boolean;
    await act(async () => {
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(false);
    expect(stateReads).toBe(1);
    expect(hook.status).toBe("unconnected");
    expect(hook.state).toBeNull();
  });

  it("allows public refresh to apply a disconnected read when connection was already established", async () => {
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        stateReads += 1;
        return stateReads === 1 ? connectedState() : disconnectedState();
      }
      return response({ ok: true });
    });
    await mount();

    let refreshed!: boolean;
    await act(async () => {
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(true);
    expect(hook.status).toBe("unconnected");
    expect(hook.state?.connected).toBe(false);
  });

  it("applies a connected public refresh when the connection was already established", async () => {
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        stateReads += 1;
        return stateReads === 1 ? connectedState("old@example.com") : connectedState("new@example.com");
      }
      return response({ ok: true });
    });
    await mount();

    let refreshed!: boolean;
    await act(async () => {
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(true);
    expect(stateReads).toBe(2);
    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("new@example.com");
  });

  it("never lets a public refresh discover connected state from unconnected", async () => {
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        stateReads += 1;
        return disconnectedState();
      }
      return response({ ok: true });
    });
    await mount();

    let refreshed!: boolean;
    await act(async () => {
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(false);
    expect(stateReads).toBe(1);
    expect(hook.status).toBe("unconnected");
    expect(hook.state?.connected).toBe(false);
  });

  it("returns false immediately for a refresh started while disconnect is in flight", async () => {
    const disconnect = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return connectedState();
      }
      if (url.endsWith("/api/google/composio/disconnect")) return disconnect.promise;
      return response({ ok: true });
    });
    await mount();

    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    let refreshed!: boolean;
    await act(async () => {
      disconnectPromise = hook.disconnect();
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(false);
    expect(stateReads).toBe(1);
    await act(async () => {
      disconnect.resolve(response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true }));
      await disconnectPromise;
    });
  });

  it("rejects a malformed 2xx state body before applying it", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) return response({ connected: "yes" });
      return response({ ok: true });
    });
    await mount();

    expect(hook.status).toBe("error:unknown");
    expect(hook.state).toBeNull();
  });

  it.each([
    ["disconnected", { outcome: "disconnected", remoteRevoked: true, localRevoked: true }],
    ["local_only", { outcome: "local_only", remoteRevoked: false, localRevoked: true, warning: "Google access may remain." }],
    ["failed without local removal", { outcome: "failed", remoteRevoked: true, localRevoked: false, error: "local unavailable" }],
    ["failed after local removal", { outcome: "failed", remoteRevoked: true, localRevoked: true, error: "cache_clear_failed" }],
  ])("returns the typed %s disconnect outcome", async (_label, expected) => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/disconnect")) return response(expected as Record<string, unknown>, expected.outcome !== "failed");
      return response({ ok: true });
    });
    await mount();
    let result!: Awaited<ReturnType<typeof hook.disconnect>>;
    await act(async () => {
      result = await hook.disconnect();
    });
    expect(result).toMatchObject(expected);
  });

  it("clears the disconnect lock after a failed response so connected refreshes can resume", async () => {
    const disconnect = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return stateReads === 1 ? connectedState() : disconnectedState();
      }
      if (url.endsWith("/api/google/composio/disconnect")) return disconnect.promise;
      return response({ ok: true });
    });
    await mount();

    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    await act(async () => {
      disconnectPromise = hook.disconnect();
    });
    await act(async () => {
      disconnect.resolve(response({ ok: false, outcome: "failed", remoteRevoked: false, localRevoked: false, error: "local unavailable" }, false, 500));
      await disconnectPromise;
    });
    let refreshed!: boolean;
    await act(async () => {
      refreshed = await hook.refresh();
    });

    expect(refreshed).toBe(true);
    expect(stateReads).toBe(2);
    expect(hook.status).toBe("unconnected");
  });

  it.each([
    ["disconnected with both revocations false", { outcome: "disconnected", remoteRevoked: false, localRevoked: false }],
    ["local_only with wrong flags", { outcome: "local_only", remoteRevoked: true, localRevoked: true, warning: "Google access may remain." }],
    ["failed with an empty error", { outcome: "failed", remoteRevoked: false, localRevoked: true, error: "" }],
  ])("rejects a type-valid but semantically invalid %s payload", async (_label, invalid) => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return disconnectedState();
      if (url.endsWith("/api/google/composio/disconnect")) return response(invalid as Record<string, unknown>);
      return response({ ok: true });
    });
    await mount();
    let result!: Awaited<ReturnType<typeof hook.disconnect>>;
    await act(async () => {
      result = await hook.disconnect();
    });

    expect(result).toEqual({ outcome: "failed", remoteRevoked: false, localRevoked: false, error: "Disconnect failed" });
  });
});

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

describe("useGoogleConnection polling invalidation", () => {
  it("discovers connected state on mount", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        return response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      return response({ ok: true });
    });
    await mount();

    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("family@example.com");
  });

  it("discovers connected state after explicit device-flow completion", async () => {
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({
          ok: true,
          connected: stateReads > 1,
          account_email: stateReads > 1 ? "family@example.com" : null,
          granted_at: null,
          revoked_at: null,
          expires_at: null,
          scope: null,
          minutes_until_expiry: null,
        });
      }
      if (url.endsWith("/api/google/device-grant")) {
        return response({ ok: true, attempt_id: "attempt-1", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      }
      if (url.endsWith("/api/google/device-poll")) return response({ ok: true, status: "complete" });
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    expect(stateReads).toBe(2);
    expect(hook.status).toBe("connected");
    expect(hook.state?.account_email).toBe("family@example.com");
  });

  it("ignores a deferred public refresh after cancel", async () => {
    const pendingState = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/google/state")) {
        stateReads += 1;
        if (stateReads === 1) return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
        return pendingState.promise;
      }
      return response({ ok: true });
    });
    await mount();

    const refreshPromise = hook.refresh();
    act(() => hook.cancel());
    await act(async () => {
      pendingState.resolve(response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null }));
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
        if (stateReads === 1) {
          return response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
        }
        if (stateReads === 2) return pendingState.promise;
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-revoke")) {
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
      pendingState.resolve(response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null }));
      await refreshPromise;
    });

    expect(hook.status).toBe("unconnected");
    expect(hook.state).toBeNull();
    expect(stateReads).toBe(2);
  });

  it("rejects a post-transition refresh without another state read", async () => {
    const revoke = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-revoke")) return revoke.promise;
      return response({ ok: true });
    });
    await mount();

    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    await act(async () => {
      disconnectPromise = hook.disconnect();
    });
    await act(async () => {
      revoke.resolve(response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true }));
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
        return response({
          ok: true,
          connected: stateReads === 1,
          account_email: stateReads === 1 ? "family@example.com" : null,
          granted_at: null,
          revoked_at: null,
          expires_at: null,
          scope: null,
          minutes_until_expiry: null,
        });
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
        return response({
          ok: true,
          connected: true,
          account_email: stateReads === 1 ? "old@example.com" : "new@example.com",
          granted_at: null,
          revoked_at: null,
          expires_at: null,
          scope: null,
          minutes_until_expiry: null,
        });
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
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
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
    const revoke = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({ ok: true, connected: true, account_email: "family@example.com", granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-revoke")) return revoke.promise;
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
      revoke.resolve(response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true }));
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

  it("rejects a malformed 2xx device grant body", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      if (url.endsWith("/api/google/device-grant")) return response({ ok: true, device_code: "incomplete" });
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });

    expect(hook.status).toBe("error:unknown");
    expect(hook.waiting).toBeNull();
  });

  it("rejects a malformed 2xx poll body instead of waiting forever", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      if (url.endsWith("/api/google/device-grant")) return response({ ok: true, attempt_id: "attempt-1", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      if (url.endsWith("/api/google/device-poll")) return response({ ok: true });
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);

    expect(hook.status).toBe("error:unknown");
    expect(hook.waiting).toBeNull();
  });
  it.each([
    ["disconnected", { outcome: "disconnected", remoteRevoked: true, localRevoked: true }],
    ["local_only", { outcome: "local_only", remoteRevoked: false, localRevoked: true, warning: "Google access may remain." }],
    ["failed without local removal", { outcome: "failed", remoteRevoked: true, localRevoked: false, error: "local unavailable" }],
    ["failed after local removal", { outcome: "failed", remoteRevoked: true, localRevoked: true, error: "cache_clear_failed" }],
  ])("returns the typed %s disconnect outcome", async (_label, expected) => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      if (url.endsWith("/api/google/device-revoke")) return response(expected as Record<string, unknown>, expected.outcome !== "failed");
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
    const revoke = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({
          ok: true,
          connected: stateReads === 1,
          account_email: stateReads === 1 ? "family@example.com" : null,
          granted_at: null,
          revoked_at: null,
          expires_at: null,
          scope: null,
          minutes_until_expiry: null,
        });
      }
      if (url.endsWith("/api/google/device-revoke")) return revoke.promise;
      return response({ ok: true });
    });
    await mount();

    let disconnectPromise!: ReturnType<typeof hook.disconnect>;
    await act(async () => {
      disconnectPromise = hook.disconnect();
    });
    await act(async () => {
      revoke.resolve(response({ ok: false, outcome: "failed", remoteRevoked: false, localRevoked: false, error: "local unavailable" }, false, 500));
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
      if (url.endsWith("/api/google/state")) return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      if (url.endsWith("/api/google/device-revoke")) return response(invalid as Record<string, unknown>);
      return response({ ok: true });
    });
    await mount();
    let result!: Awaited<ReturnType<typeof hook.disconnect>>;
    await act(async () => {
      result = await hook.disconnect();
    });

    expect(result).toEqual({ outcome: "failed", remoteRevoked: false, localRevoked: false, error: "Disconnect failed" });
  });

  it("does not let a deferred poll restore state after cancel", async () => {
    const poll = deferred<any>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-grant")) {
        return response({ ok: true, attempt_id: "attempt-1", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      }
      if (url.endsWith("/api/google/device-poll")) return poll.promise;
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
      poll.resolve(response({ ok: true, status: "complete" }));
      await Promise.resolve();
    });
    await flush(10000);

    expect(stateReads).toBe(readsBeforeCancel);
    expect(hook.status).toBe("unconnected");
  });

  it("invalidates the server attempt when the user cancels device flow", async () => {
    const poll = deferred<any>();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-grant")) {
        return response({ ok: true, attempt_id: "attempt-cancel", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      }
      if (url.endsWith("/api/google/device-poll")) return poll.promise;
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });
    await flush(5000);
    act(() => hook.cancel());

    const revokeCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/google/device-revoke"));
    expect(revokeCall).toBeTruthy();
    expect(JSON.parse(String((revokeCall?.[1] as RequestInit).body))).toEqual({ action: "cancel", attempt_id: "attempt-cancel" });
  });

  it("issues a non-abortable server invalidation when unmounted during device flow", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-grant")) {
        return response({ ok: true, attempt_id: "attempt-unmount", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      }
      return response({ ok: true });
    });
    await mount();
    await act(async () => {
      await hook.connect();
    });

    const root = roots.pop();
    if (root) act(() => root.unmount());

    const revokeCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/google/device-revoke"));
    expect(revokeCall).toBeTruthy();
    expect((revokeCall?.[1] as RequestInit).keepalive).toBe(true);
    expect(JSON.parse(String((revokeCall?.[1] as RequestInit).body))).toEqual({ action: "cancel", attempt_id: "attempt-unmount" });
  });

  it("does not let a deferred poll restore state after disconnect", async () => {
    const poll = deferred<any>();
    const pollJson = deferred<Record<string, unknown>>();
    let stateReads = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/google/state")) {
        stateReads += 1;
        return response({ ok: true, connected: false, account_email: null, granted_at: null, revoked_at: null, expires_at: null, scope: null, minutes_until_expiry: null });
      }
      if (url.endsWith("/api/google/device-grant")) {
        return response({ ok: true, attempt_id: "attempt-1", device_code: "device", user_code: "code", verification_url: "https://google.test/device", expires_in: 600, interval: 5 });
      }
      if (url.endsWith("/api/google/device-revoke")) return response({ ok: true, outcome: "disconnected", remoteRevoked: true, localRevoked: true });
      if (url.endsWith("/api/google/device-poll")) return poll.promise;
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
      poll.resolve({ ok: true, json: () => pollJson.promise });
      await Promise.resolve();
    });
    await act(async () => {
      pollJson.resolve({ ok: true, status: "complete" });
      await Promise.resolve();
    });
    await flush(10000);

    expect(stateReads).toBe(readsAfterDisconnect);
    expect(hook.status).toBe("unconnected");
  });
});

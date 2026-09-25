// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    connected: true,
    account_email: "family@example.com",
    granted_at: "2026-09-20T10:00:00.000Z",
    revoked_at: null,
    expires_at: null,
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
    minutes_until_expiry: null,
  };
  return {
    currentGeneration: 1,
    hook: {
      mounted: true,
      status: "connected" as string,
      statusVersion: 1,
      generation: 1,
      isCurrentGeneration: vi.fn((generation: number) => generation === mocks.currentGeneration),
      state,
      waiting: null,
      errorMessage: null,
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => ({ outcome: "disconnected", remoteRevoked: true, localRevoked: true })),
      cancel: vi.fn(),
      refresh: vi.fn(async () => undefined),
    },
    fetchCalls: [] as Array<{ url: string; init?: RequestInit }>,
  };
});

vi.mock("@/hooks/useGoogleConnection", () => ({
  useGoogleConnection: () => mocks.hook,
}));

import GoogleConnectCard from "@/components/settings/GoogleConnectCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function response(ok: boolean, status: number, body: Record<string, unknown> = {}) {
  return { ok, status, statusText: status === 200 ? "OK" : "Error", json: async () => body };
}

function stubFetch(update: (url: string, init?: RequestInit) => ReturnType<typeof response> | Promise<ReturnType<typeof response>> = () => response(true, 200, {})) {
  mocks.fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    mocks.fetchCalls.push({ url, init });
    return update(url, init);
  }));
}

function render(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(ui));
  return host;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(scope: ParentNode, pattern: RegExp): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll("button")).find((candidate) =>
    pattern.test(candidate.textContent || "") || pattern.test(candidate.getAttribute("aria-label") || ""),
  );
  if (!result) throw new Error(`Button matching ${pattern} not found`);
  return result;
}

function dialog(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!result) throw new Error("Dialog not found");
  return result;
}

beforeEach(() => {
  mocks.hook.mounted = true;
  mocks.hook.status = "connected";
  mocks.hook.statusVersion = 1;
  mocks.currentGeneration = 1;
  mocks.hook.generation = 1;
  mocks.hook.isCurrentGeneration.mockClear();
  mocks.hook.state = {
    connected: true,
    account_email: "family@example.com",
    granted_at: "2026-09-20T10:00:00.000Z",
    revoked_at: null,
    expires_at: null,
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
    minutes_until_expiry: null,
  };
  mocks.hook.waiting = null;
  mocks.hook.errorMessage = null;
  mocks.hook.disconnect.mockReset();
  mocks.hook.disconnect.mockResolvedValue({ outcome: "disconnected", remoteRevoked: true, localRevoked: true } as any);
  mocks.hook.connect.mockClear();
  mocks.hook.cancel.mockClear();
  mocks.hook.refresh.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  stubFetch((url) => {
    if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
    if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
    if (url.endsWith("/api/google/sync")) return response(true, 200, { ok: true, calendar: { events: 2 } });
    return response(true, 200, {});
  });
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

describe("GoogleConnectCard", () => {
  it("owns its card and promises Calendar sync without Tasks or Reminders copy", async () => {
    const host = render(<GoogleConnectCard />);
    await settle();

    expect(host.querySelector(".settings-google-card")).toBeTruthy();
    expect(host.textContent).toContain("Google Calendar");
    expect(host.textContent).toContain("Calendar sync");
    expect(host.textContent).not.toMatch(/Tasks|Reminders/);
    expect(host.querySelectorAll(".widget-card .widget-card")).toHaveLength(0);
  });

  it("syncs only the calendar resource", async () => {
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /Sync now/).click());
    await settle();

    const call = mocks.fetchCalls.find((candidate) => candidate.url.endsWith("/api/google/sync"));
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call!.init?.body))).toEqual({ resource: "calendar" });
    expect(host.textContent).toContain("2 events");
    expect(host.textContent).not.toMatch(/tasks/i);
  });

  it("does not report a partial calendar selection save as saved", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/api/google/calendars") && init?.method === "PUT") {
        return response(true, 200, { ok: true, errors: [{ id: "family", error: "selection failed" }] });
      }
      if (url.endsWith("/api/google/calendars")) {
        return response(true, 200, { ok: true, calendars: [{ id: "primary", summary: "Primary", colorRgb: null, selected: true, lastSyncAt: null }, { id: "family", summary: "Family", colorRgb: null, selected: false, lastSyncAt: null }] });
      }
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    const family = host.querySelector<HTMLInputElement>('input[aria-label="Sync Family"]')!;
    await act(async () => family.click());
    await act(async () => button(host, /Save calendars/).click());
    await settle();

    expect(host.textContent).toContain("1 calendar failed");
    expect(host.textContent).not.toContain("Saved ✓");
    expect(button(host, /Save calendars/).disabled).toBe(false);
  });

  it("does not report a partial calendar sync as successful", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync")) {
        return response(true, 200, { ok: true, calendar: { events: 2, perCalendar: [{ calendarId: "family", ok: false, error: "quota" }] } });
      }
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /Sync now/).click());
    await settle();

    expect(host.textContent).toContain("1 calendar failed");
    expect(host.textContent).not.toContain("Synced 2 events");
  });

  it("keeps a skipped calendar sync retryable instead of calling it up to date", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync")) return response(true, 200, { ok: true, calendar: { skipped: true, reason: "already_in_progress" } });
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /Sync now/).click());
    await settle();

    expect(host.textContent).toContain("already in progress");
    expect(host.textContent).not.toContain("Calendar is up to date");
  });
  it("keeps the specific skip reason from a top-level sync failure", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync")) {
        return response(false, 409, { ok: false, error: "calendar_sync_skipped", skipped: true, calendar: { skipped: true, reason: "already_in_progress" } });
      }
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /Sync now/).click());
    await settle();

    expect(host.textContent).toContain("already in progress");
    expect(host.textContent).not.toContain("calendar_sync_skipped");
  });

  it("rejects a malformed 2xx sync-state read and shows an honest error", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: 42 });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    expect(host.textContent).toContain("Couldn't load the last calendar sync time");
    expect(host.textContent).not.toContain("Last auto-sync");
  });

  it("rejects a malformed calendar row instead of rendering unchecked data", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) {
        return response(true, 200, { ok: true, calendars: [{ id: "primary", summary: 42, colorRgb: null, selected: true, lastSyncAt: null }] });
      }
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    expect(host.textContent).toContain("Couldn't load your calendars");
    expect(host.querySelector('input[aria-label^="Sync "]')).toBeNull();
  });

  it("rejects a malformed 2xx calendar save body", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/api/google/calendars") && init?.method === "PUT") return response(true, 200, { ok: true, errors: "not-an-array" });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [{ id: "primary", summary: "Primary", colorRgb: null, selected: true, lastSyncAt: null }, { id: "family", summary: "Family", colorRgb: null, selected: false, lastSyncAt: null }] });
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Sync Family"]')!.click());
    await act(async () => button(host, /Save calendars/).click());
    await settle();

    expect(host.textContent).toContain("Save failed");
    expect(host.textContent).not.toContain("Saved ✓");
  });

  it("rejects a malformed 2xx calendar sync body", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync")) return response(true, 200, { ok: true, calendar: { events: 2, perCalendar: "bad" } });
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /Sync now/).click());
    await settle();

    expect(host.textContent).toContain("Calendar sync failed");
    expect(host.textContent).not.toContain("Synced 2 events");
  });
  it("ignores a deferred calendar save after the connection generation changes", async () => {
    const pending = deferred<any>();
    stubFetch((url, init) => {
      if (url.endsWith("/api/google/calendars") && init?.method === "PUT") return pending.promise;
      if (url.endsWith("/api/google/calendars")) {
        return response(true, 200, { ok: true, calendars: [{ id: "primary", summary: "Primary", colorRgb: null, selected: true, lastSyncAt: null }, { id: "family", summary: "Family", colorRgb: null, selected: false, lastSyncAt: null }] });
      }
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Sync Family"]')!.click());
    await act(async () => button(host, /Save calendars/).click());

    mocks.currentGeneration = 2;
    await act(async () => {
      pending.resolve(response(true, 200, { ok: true, calendars: [] }));
      await Promise.resolve();
    });
    await settle();

    expect(host.textContent).not.toContain("Saved");
    expect(mocks.hook.refresh).not.toHaveBeenCalled();
  });

  it("disables calendar selection while saving so a late response cannot replace a newer edit", async () => {
    const pending = deferred<any>();
    stubFetch((url, init) => {
      if (url.endsWith("/api/google/calendars") && init?.method === "PUT") return pending.promise;
      if (url.endsWith("/api/google/calendars")) {
        return response(true, 200, { ok: true, calendars: [
          { id: "primary", summary: "Primary", colorRgb: null, selected: true, lastSyncAt: null },
          { id: "family", summary: "Family", colorRgb: null, selected: false, lastSyncAt: null },
        ] });
      }
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    const family = host.querySelector<HTMLInputElement>('input[aria-label="Sync Family"]')!;
    await act(async () => family.click());
    await act(async () => button(host, /Save calendars/).click());

    expect(family.disabled).toBe(true);
    await act(async () => {
      family.disabled = false;
      family.click();
    });
    expect(family.checked).toBe(false);

    await act(async () => {
      pending.resolve(response(true, 200, { ok: true, calendars: [] }));
      await Promise.resolve();
    });
    await settle();

    expect(host.textContent).not.toContain("Saved ✓");
  });

  it("ignores a deferred calendar sync after the connection generation changes", async () => {
    const pending = deferred<any>();
    stubFetch((url) => {
      if (url.endsWith("/api/google/sync")) return pending.promise;
      if (url.endsWith("/api/google/sync-state")) return response(true, 200, { ok: true, calendar_last_sync_at: null });
      if (url.endsWith("/api/google/calendars")) return response(true, 200, { ok: true, calendars: [] });
      return response(true, 200, {});
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /Sync now/).click());

    mocks.currentGeneration = 2;
    await act(async () => {
      pending.resolve(response(true, 200, { ok: true, calendar: { events: 2 } }));
      await Promise.resolve();
    });
    await settle();

    expect(host.textContent).not.toContain("Synced 2 events");
    expect(mocks.hook.refresh).not.toHaveBeenCalled();
  });
  it("confirms disconnect, waits for the typed result, and closes only after success", async () => {
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /^Disconnect$/).click());
    expect(mocks.hook.disconnect).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Disconnect Google Calendar?");

    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();

    expect(mocks.hook.disconnect).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Disconnected");
  });

  it("focuses a persistent disconnect status after the connected trigger disappears", async () => {
    mocks.hook.disconnect.mockImplementation(async () => {
      mocks.hook.status = "unconnected";
      mocks.hook.state = null as any;
      return { outcome: "disconnected", remoteRevoked: true, localRevoked: true } as any;
    });
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();

    const status = host.querySelector<HTMLElement>('[data-google-disconnect-status="true"]');
    expect(status?.textContent).toContain("Disconnected from Google Calendar");
    expect(document.activeElement).toBe(status);
  });

  it("clears the disconnect status when reconnect starts", async () => {
    mocks.hook.disconnect.mockImplementation(async () => {
      mocks.hook.status = "unconnected";
      mocks.hook.state = null as any;
      return { outcome: "disconnected", remoteRevoked: true, localRevoked: true } as any;
    });
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();
    expect(host.querySelector('[data-google-disconnect-status="true"]')).toBeTruthy();

    await act(async () => button(host, /Connect Google account/).click());
    expect(host.querySelector('[data-google-disconnect-status="true"]')).toBeNull();
  });
  it("shows a truthful warning when only local tokens were removed", async () => {
    mocks.hook.disconnect.mockResolvedValue({
      outcome: "local_only",
      remoteRevoked: false,
      localRevoked: true,
      warning: "Google access may remain.",
    } as any);
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();

    expect(host.textContent).toContain("Disconnected from the family server. Google access may remain remotely.");
    expect(host.textContent).not.toContain("Disconnected from Google Calendar");
  });
  it.each([
    ["disconnected with both revocations false", { outcome: "disconnected", remoteRevoked: false, localRevoked: false }],
    ["local_only with wrong flags", { outcome: "local_only", remoteRevoked: true, localRevoked: true, warning: "Google access may remain." }],
    ["failed with an empty error", { outcome: "failed", remoteRevoked: false, localRevoked: true, error: "" }],
  ])("keeps the disconnect dialog open for semantically invalid %s data", async (_label, invalid) => {
    mocks.hook.disconnect.mockResolvedValue(invalid as any);
    const host = render(<GoogleConnectCard />);
    await settle();
    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();

    expect(dialog().textContent).toContain("Disconnect returned an invalid response");
    expect(host.querySelector('[data-google-disconnect-status="true"]')).toBeNull();
  });

  it("renders a countdown placeholder until the clock is ready", () => {
    vi.useFakeTimers();
    mocks.hook.status = "waiting";
    mocks.hook.state = null as any;
    mocks.hook.waiting = {
      device_code: "device",
      user_code: "code",
      verification_url: "https://google.test/device",
      expires_at: Date.now() + 600_000,
      interval: 5,
    } as any;
    const host = render(<GoogleConnectCard />);

    const countdown = host.querySelector('[data-google-countdown="true"]');
    expect(countdown?.getAttribute("data-ready")).toBe("false");
    expect(countdown?.textContent).toContain("--:--");
  });
  it("clears countdown timers when the waiting card unmounts", async () => {
    vi.useFakeTimers();
    mocks.hook.status = "waiting";
    mocks.hook.state = null as any;
    mocks.hook.waiting = {
      device_code: "device",
      user_code: "code",
      verification_url: "https://google.test/device",
      expires_at: Date.now() + 600_000,
      interval: 5,
    } as any;
    const host = render(<GoogleConnectCard />);
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    const root = roots.pop();
    if (root) act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the disconnect focus timer when the card unmounts", async () => {
    vi.useFakeTimers();
    mocks.hook.disconnect.mockImplementation(async () => {
      mocks.hook.status = "unconnected";
      mocks.hook.state = null as any;
      return { outcome: "disconnected", remoteRevoked: true, localRevoked: true } as any;
    });
    const host = render(<GoogleConnectCard />);
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    const before = vi.getTimerCount();
    const root = roots.pop();
    if (root) act(() => root.unmount());
    expect(vi.getTimerCount()).toBeLessThan(before);
  });
  it("keeps the connection honest when disconnect fails", async () => {
    mocks.hook.disconnect.mockResolvedValue({ outcome: "failed", error: "Couldn't disconnect" } as any);
    const host = render(<GoogleConnectCard />);
    await settle();

    await act(async () => button(host, /^Disconnect$/).click());
    await act(async () => button(dialog(), /Disconnect Google/).click());
    await settle();

    expect(dialog().textContent).toContain("Couldn't disconnect Google Calendar");
    expect(host.textContent).toContain("Connected as family@example.com");
    expect(host.textContent).not.toContain("Couldn't disconnect Google Calendar");
    expect(host.textContent).not.toContain("Disconnected");
  });
});

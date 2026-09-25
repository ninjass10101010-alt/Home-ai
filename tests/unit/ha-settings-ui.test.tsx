// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HaNotificationsCard from "@/components/settings/HaNotificationsCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface CallRecord {
  url: string;
  body?: unknown;
}

interface PrefsPayload {
  briefing: boolean;
  weather: boolean;
  calendar: boolean;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function stubFetch(
  payload: unknown | null,
  opts: { fail?: boolean; prefs?: PrefsPayload } = {}
) {
  const calls: CallRecord[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (opts.fail) return { ok: false, status: 503, json: async () => ({ ok: false }) };
    if (u.endsWith("/api/ha/notify-targets")) {
      return { ok: true, status: 200, json: async () => payload };
    }
    if (u.endsWith("/api/ha/notify-prefs") && (init?.method ?? "GET").toUpperCase() === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, prefs: opts.prefs ?? { briefing: false, weather: false, calendar: false } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function findButton(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => text.test(b.textContent || "") || text.test(b.getAttribute("aria-label") || ""));
  if (!btn) throw new Error(`button ${text} not found`);
  return btn as HTMLButtonElement;
}

describe("HaNotificationsCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders HA targets plus the Telegram row only when available", async () => {
    stubFetch({ ok: true, telegramAvailable: true, targets: [
      { target: "notify.mobile_app_jefferys_iphone", enabled: false },
      { target: "notify.mobile_app_zoe", enabled: true },
    ]});
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).toContain("Jefferys Iphone");
    expect(el.textContent).toContain("Zoe");
    expect(el.textContent).toContain("Telegram");
    expect(el.textContent).toContain("Notifications");
  });

  it("hides the Telegram row when unavailable", async () => {
    stubFetch({ ok: true, telegramAvailable: false, targets: [] });
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).not.toContain("(Telegram)");
    expect(el.textContent).toContain("No HA companion devices found");
  });

  it("toggling a row posts the notify-config body and flips the switch", async () => {
    const { calls } = stubFetch({ ok: true, telegramAvailable: false, targets: [
      { target: "notify.mobile_app_zoe", enabled: false },
    ]});
    const el = render(<HaNotificationsCard />);
    await settle();

    const toggle = el.querySelector('input[aria-label*="Zoe"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.click();
    });
    await settle();

    const configCall = calls.find((c) => c.url.endsWith("/api/ha/notify-config"));
    expect(configCall?.body).toEqual({ target: "notify.mobile_app_zoe", enabled: true });
  });

  it("the Test button posts a notify-test for that target and shows Sent", async () => {
    const { calls } = stubFetch({ ok: true, telegramAvailable: false, targets: [
      { target: "notify.mobile_app_zoe", enabled: true },
    ]});
    const el = render(<HaNotificationsCard />);
    await settle();

    act(() => findButton(el, /Send test notification to Zoe/).click());
    await settle();

    const testCall = calls.find((c) => c.url.endsWith("/api/ha/notify-test"));
    expect(testCall?.body).toEqual({ target: "notify.mobile_app_zoe" });
    expect(el.textContent).toContain("Sent ✓");
  });

  it("rejects malformed target rows and reports notifications unavailable", async () => {
    stubFetch({ ok: true, telegramAvailable: false, targets: [
      { target: "notify.mobile_app_zoe", enabled: "yes" },
    ]});
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).toContain("unavailable right now");
    expect(el.textContent).not.toContain("Zoe");
  });

  it("shows a graceful fallback when the route fails", async () => {
    stubFetch(null, { fail: true });
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).toContain("unavailable right now");
  });

  it("renders the three prefs toggles and POSTs when one is flipped", async () => {
    const { calls } = stubFetch(
      { ok: true, telegramAvailable: false, targets: [] },
      { prefs: { briefing: false, weather: false, calendar: false } }
    );
    const el = render(<HaNotificationsCard />);
    await settle();

    const weatherToggle = el.querySelector('input[aria-label*="Severe weather"]') as HTMLInputElement;
    expect(weatherToggle).toBeTruthy();
    expect(el.querySelector('input[aria-label*="Morning briefing"]')).toBeTruthy();
    expect(el.querySelector('input[aria-label*="Important calendar events"]')).toBeTruthy();

    act(() => {
      weatherToggle.click();
    });
    await settle();

    const prefCall = calls.find((c) => c.url.endsWith("/api/ha/notify-prefs") && c.body);
    expect(prefCall?.body).toEqual({ key: "weather", enabled: true });
  });

  it("renders configured Telegram once as Always on with Test and no fake toggle", async () => {
    const payload = {
      ok: true,
      telegramAvailable: true,
      targets: [{ target: "notify.mobile_app_zoe", enabled: false }],
    };
    const { calls } = stubFetch(payload);
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.querySelectorAll('[data-ha-telegram-row="true"]')).toHaveLength(1);
    expect(el.textContent).toContain("Telegram");
    expect(el.textContent).toContain("Always on");
    expect(el.querySelector('input[aria-label*="Telegram"]')).toBeNull();
    expect(payload.targets).toHaveLength(1);

    await act(async () => findButton(el, /Send test notification to Telegram/).click());
    await settle();

    expect(calls.find((call) => call.url.endsWith("/api/ha/notify-test"))?.body).toEqual({ channel: "telegram" });
    expect(calls.find((call) => call.url.endsWith("/api/ha/notify-config"))).toBeUndefined();
  });

  it("keeps an HA target unchanged and reports an error when its write fails", async () => {
    const payload = { ok: true, telegramAvailable: false, targets: [{ target: "notify.mobile_app_zoe", enabled: false }] };
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-config")) return { ok: false, status: 502, json: async () => ({ ok: false }) };
      if (u.endsWith("/api/ha/notify-prefs")) return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) };
      return { ok: true, status: 200, json: async () => payload };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();

    const toggle = el.querySelector('input[aria-label*="Zoe"]') as HTMLInputElement;
    await act(async () => toggle.click());
    await settle();

    expect(toggle.checked).toBe(false);
    expect(el.textContent).toContain("Couldn't update Zoe");
    expect(payload.targets[0].enabled).toBe(false);
    expect(calls.find((call) => call.url.endsWith("/api/ha/notify-config"))?.body).toEqual({
      target: "notify.mobile_app_zoe",
      enabled: true,
    });
  });

  it("invalidates a deferred load when the card unmounts", async () => {
    const prefsRead = deferred<any>();
    const errors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/ha/notify-targets")) return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [] }) };
      if (u.endsWith("/api/ha/notify-prefs")) return prefsRead.promise;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<HaNotificationsCard />));
    await settle();
    act(() => root.unmount());
    await act(async () => {
      prefsRead.resolve({ ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) });
      await Promise.resolve();
    });

    expect(errors.some((args) => String(args[0]).includes("unmounted"))).toBe(false);
    errorSpy.mockRestore();
  });
  it("keeps target and preference controls disabled until the full prefs read finishes", async () => {
    const prefsRead = deferred<any>();
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-targets")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [{ target: "notify.mobile_app_zoe", enabled: false }] }) };
      }
      if (u.endsWith("/api/ha/notify-prefs") && (init?.method ?? "GET").toUpperCase() === "GET") return prefsRead.promise;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();

    const targetToggle = el.querySelector<HTMLInputElement>('input[aria-label*="Zoe"]')!;
    const prefToggle = el.querySelector<HTMLInputElement>('input[aria-label*="Severe weather"]')!;
    expect(targetToggle.disabled).toBe(true);
    expect(prefToggle.disabled).toBe(true);
    await act(async () => {
      targetToggle.click();
      prefToggle.click();
    });
    expect(calls.some((call) => call.body && (call.url.endsWith("/notify-config") || call.url.endsWith("/notify-prefs")))).toBe(false);

    await act(async () => {
      prefsRead.resolve({ ok: true, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) });
      await Promise.resolve();
    });
    await settle();
    expect(targetToggle.disabled).toBe(false);
    expect(prefToggle.disabled).toBe(false);
  });

  it("surfaces an invalid or failed prefs read and keeps controls disabled", async () => {
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-targets")) return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [] }) };
      if (u.endsWith("/api/ha/notify-prefs")) return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { weather: false } }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).toContain("Couldn't load the alert preferences");
    expect(el.querySelector<HTMLInputElement>('input[aria-label*="Severe weather"]')?.disabled).toBe(true);
  });

  it("classifies stale Telegram rows even when the availability flag is false", async () => {
    stubFetch({ ok: true, telegramAvailable: false, targets: [{ target: "telegram", enabled: false }] });
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.querySelectorAll('[data-ha-telegram-row="true"]')).toHaveLength(1);
    expect(el.textContent).toContain("Telegram unavailable");
    expect(el.querySelector('input[aria-label*="Telegram"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Send test notification to Telegram"]')).toBeNull();
  });

  it("guards duplicate preference confirmations while a write is pending", async () => {
    const pending = deferred<any>();
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-targets")) return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [] }) };
      if (u.endsWith("/api/ha/notify-prefs") && (init?.method ?? "GET").toUpperCase() === "GET") return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) };
      if (u.endsWith("/api/ha/notify-prefs")) return pending.promise;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();
    const toggle = el.querySelector<HTMLInputElement>('input[aria-label*="Severe weather"]')!;
    await act(async () => {
      toggle.click();
      toggle.click();
    });
    expect(calls.filter((call) => call.body && call.url.endsWith("/notify-prefs"))).toHaveLength(1);
    await act(async () => {
      pending.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      await Promise.resolve();
    });
    await settle();
  });

  it("guards duplicate target confirmations while a write is pending", async () => {
    const pending = deferred<any>();
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-targets")) return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [{ target: "notify.mobile_app_zoe", enabled: false }] }) };
      if (u.endsWith("/api/ha/notify-prefs")) return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) };
      if (u.endsWith("/api/ha/notify-config")) return pending.promise;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();
    const toggle = el.querySelector<HTMLInputElement>('input[aria-label*="Zoe"]')!;
    await act(async () => {
      toggle.click();
      toggle.click();
    });
    expect(calls.filter((call) => call.body && call.url.endsWith("/notify-config"))).toHaveLength(1);
    await act(async () => {
      pending.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      await Promise.resolve();
    });
    await settle();
  });
  it("resets the preference write guard after completion", async () => {
    let writes = 0;
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-targets")) return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [] }) };
      if (u.endsWith("/api/ha/notify-prefs") && (init?.method ?? "GET").toUpperCase() === "GET") return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) };
      if (u.endsWith("/api/ha/notify-prefs")) {
        writes += 1;
        return writes === 1
          ? { ok: false, status: 502, json: async () => ({ ok: false }) }
          : { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();
    const toggle = el.querySelector<HTMLInputElement>('input[aria-label*="Severe weather"]')!;
    await act(async () => toggle.click());
    await settle();
    await act(async () => toggle.click());
    await settle();

    expect(calls.filter((call) => call.body && call.url.endsWith("/notify-prefs"))).toHaveLength(2);
  });
  it("rolls back a failed preference write and shows an error", async () => {
    const calls: CallRecord[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/notify-prefs") && (init?.method ?? "GET").toUpperCase() === "POST") {
        return { ok: false, status: 502, json: async () => ({ ok: false }) };
      }
      if (u.endsWith("/api/ha/notify-prefs")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { briefing: false, weather: false, calendar: false } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, telegramAvailable: false, targets: [] }) };
    }));
    const el = render(<HaNotificationsCard />);
    await settle();

    const weatherToggle = el.querySelector('input[aria-label*="Severe weather"]') as HTMLInputElement;
    await act(async () => weatherToggle.click());
    await settle();

    expect(weatherToggle.checked).toBe(false);
    expect(el.textContent).toContain("Couldn't update Severe weather");
    expect(calls.find((call) => call.url.endsWith("/api/ha/notify-prefs") && call.body)?.body).toEqual({
      key: "weather",
      enabled: true,
    });
  });
});

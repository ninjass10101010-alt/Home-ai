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

function stubFetch(payload: unknown | null, opts: { fail?: boolean } = {}) {
  const calls: CallRecord[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (opts.fail) return { ok: false, status: 503, json: async () => ({ ok: false }) };
    if (u.endsWith("/api/ha/notify-targets")) {
      return { ok: true, status: 200, json: async () => payload };
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

  it("shows a graceful fallback when the route fails", async () => {
    stubFetch(null, { fail: true });
    const el = render(<HaNotificationsCard />);
    await settle();

    expect(el.textContent).toContain("unavailable right now");
  });
});

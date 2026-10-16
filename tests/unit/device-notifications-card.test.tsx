// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const authState = { currentUser: null as any, hydrated: true };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

import DeviceNotificationsCard from "@/components/settings/DeviceNotificationsCard";

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

function setSecureContext(v: boolean) {
  Object.defineProperty(window, "isSecureContext", { value: v, configurable: true });
}

function installServiceWorker(sub: any) {
  const pushManager = { getSubscription: vi.fn(async () => sub) };
  const reg = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve(reg), register: vi.fn() },
    configurable: true,
  });
  return { pushManager, reg };
}

function removeServiceWorker() {
  delete (navigator as any).serviceWorker;
}

function stubNotification(permission: NotificationPermission) {
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification", { permission, requestPermission });
  return requestPermission;
}

beforeEach(() => {
  authState.currentUser = { name: "Rebecca", role: "parent" };
  authState.hydrated = true;
  setSecureContext(true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, publicKey: "BAbc" }) })));
});

afterEach(() => {
  removeServiceWorker();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("DeviceNotificationsCard", () => {
  it("shows unsupported when there is no service worker", async () => {
    removeServiceWorker();
    const root = render(<DeviceNotificationsCard />);
    await settle();
    expect(root.textContent).toContain("can't show notifications");
  });

  it("shows the signed-out state when no user", async () => {
    authState.currentUser = null;
    installServiceWorker(null);
    stubNotification("default");
    const root = render(<DeviceNotificationsCard />);
    await settle();
    expect(root.textContent).toContain("Sign in to turn on notifications");
  });

  it("shows an Enable button when capable and not subscribed", async () => {
    installServiceWorker(null);
    stubNotification("default");
    const root = render(<DeviceNotificationsCard />);
    await settle();
    const btn = Array.from(root.querySelectorAll("button")).find((b) => /Enable on this device/.test(b.textContent || ""));
    expect(btn).toBeTruthy();
  });

  it("shows On + Send test + Turn off when subscribed", async () => {
    installServiceWorker({ endpoint: "https://e/1", unsubscribe: vi.fn(async () => true) });
    stubNotification("granted");
    const root = render(<DeviceNotificationsCard />);
    await settle();
    expect(root.textContent).toContain("On · this device");
    const buttons = Array.from(root.querySelectorAll("button")).map((b) => b.textContent || "");
    expect(buttons.some((t) => /Send test/.test(t))).toBe(true);
    expect(buttons.some((t) => /Turn off/.test(t))).toBe(true);
  });

  it("shows the denied state when permission is denied", async () => {
    installServiceWorker(null);
    stubNotification("denied");
    const root = render(<DeviceNotificationsCard />);
    await settle();
    expect(root.textContent).toContain("blocked");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomeControlsPage from "@/app/ha/page";
import SecurityPanel from "@/components/ha/SecurityPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/ha",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

const mockCurrentUser = vi.hoisted(() => ({ role: "parent" as string }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}));

vi.mock("@/components/ui/SyncInit", () => ({ default: () => null }));

const SYNC_STATES = [
  { entity_id: "person.jeffery", state: "home", attributes: { friendly_name: "Jeffery" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "binary_sensor.front_door", state: "on", attributes: { friendly_name: "Front door", device_class: "door" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "alarm_control_panel.alarm", state: "disarmed", attributes: { friendly_name: "Alarm" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "climate.living_room", state: "heat", attributes: { friendly_name: "Living room", hvac_mode: "heat", current_temperature: 21.5, humidity: 44, temperature: 21, area_id: "living_room" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "light.living_room", state: "on", attributes: { friendly_name: "Living Room", area_id: "living_room" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "light.kitchen", state: "off", attributes: { friendly_name: "Kitchen" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "automation.vacation", state: "off", attributes: { friendly_name: "Vacation mode" }, last_updated: "2026-08-21T12:00:00Z" },
];

interface CallRecord {
  url: string;
  body: { domain: string; service: string; serviceData?: Record<string, unknown> };
}

function stubFetch() {
  const calls: CallRecord[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/ha/sync")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, count: SYNC_STATES.length, states: SYNC_STATES }),
      };
    }
    if (u.endsWith("/api/ha/call-service")) {
      calls.push({ url: u, body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ success: true, result: { ok: true } }) };
    }
    return { ok: false, status: 404, json: async () => ({ success: false, error: "not_found" }) };
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
    await new Promise((r) => setTimeout(r, 30));
  });
}

function findButton(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => text.test(b.textContent || ""));
  if (!btn) throw new Error(`button ${text} not found`);
  return btn as HTMLButtonElement;
}

function findRadio(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button[role="radio"]')).find((b) => text.test(b.textContent || ""));
  if (!btn) throw new Error(`radio ${text} not found`);
  return btn as HTMLButtonElement;
}

describe("HA tab (/ha) HomeControlsPage", () => {
  beforeEach(() => {
    mockCurrentUser.role = "parent";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("Overview tab renders room cards and presence chips", async () => {
    stubFetch();
    const el = render(<HomeControlsPage />);
    await settle();

    expect(el.textContent).toContain("Home Controls");
    expect(el.textContent).toContain("Jeffery");
    expect(el.textContent).toContain("· home");
    expect(el.textContent).toContain("Living Room");
    expect(el.textContent).toContain("Other");
    expect(el.textContent).not.toContain("Read-only for kids");
  });

  it("Security tab shows Arm home and posts alarm_arm_home", async () => {
    const { calls } = stubFetch();
    const el = render(<HomeControlsPage />);
    await settle();

    act(() => findRadio(el, /Security/).click());
    await settle();

    const arm = findButton(el, /Arm home/);
    act(() => arm.click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      domain: "alarm_control_panel",
      service: "alarm_arm_home",
      serviceData: { entity_id: "alarm_control_panel.alarm" },
    });
  });

  it("Lights tab toggles Kitchen via light.toggle", async () => {
    const { calls } = stubFetch();
    const el = render(<HomeControlsPage />);
    await settle();

    act(() => findRadio(el, /Lights/).click());
    await settle();

    expect(el.textContent).toContain("Kitchen");
    expect(el.textContent).toContain("Living Room");

    const kitchen = findButton(el, /Kitchen/);
    act(() => kitchen.click());
    await settle();

    const toggleCall = calls.find((c) => c.body.service === "toggle");
    expect(toggleCall?.body).toEqual({
      domain: "light",
      service: "toggle",
      serviceData: { entity_id: "light.kitchen" },
    });
  });

  it("Automation tab lists automation.vacation with off state", async () => {
    stubFetch();
    const el = render(<HomeControlsPage />);
    await settle();

    act(() => findRadio(el, /Automation/).click());
    await settle();

    expect(el.textContent).toContain("Vacation mode");
    expect(el.textContent).toContain("off");
  });

  it("SecurityPanel shows no Arm home button for a child user", async () => {
    mockCurrentUser.role = "child";
    stubFetch();
    const el = render(<SecurityPanel states={SYNC_STATES} />);
    await settle();

    expect(el.textContent).toContain("Disarmed");
    const controls = Array.from(el.querySelectorAll("button")).filter((b) => /Arm home|Disarm/.test(b.textContent || ""));
    expect(controls).toHaveLength(0);
  });

  it("shows the Read-only for kids chip for a child user", async () => {
    mockCurrentUser.role = "child";
    stubFetch();
    const el = render(<HomeControlsPage />);
    await settle();

    expect(el.textContent).toContain("Read-only for kids");
  });
});

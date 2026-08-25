// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import HomeSecurityWidget from "@/components/ha/HomeSecurityWidget";
import HomeClimateWidget from "@/components/ha/HomeClimateWidget";
import HomeLightsWidget from "@/components/ha/HomeLightsWidget";
import { _resetHAStateForTests } from "@/hooks/useHAState";

const mockCurrentUser = vi.hoisted(() => ({ role: "parent" as string }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SYNC_STATES = [
  { entity_id: "person.jeffery", state: "home", attributes: { friendly_name: "Jeffery" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "person.rebecca", state: "not_home", attributes: { friendly_name: "Rebecca" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "binary_sensor.front_door", state: "on", attributes: { friendly_name: "Front door", device_class: "door" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "alarm_control_panel.alarm", state: "disarmed", attributes: { friendly_name: "Alarm" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "climate.living_room", state: "heat", attributes: { friendly_name: "Living room", hvac_mode: "heat", current_temperature: 21.5, current_humidity: 44, temperature: 21 }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" }, last_updated: "2026-08-21T12:00:00Z" },
  { entity_id: "light.hall", state: "off", attributes: { friendly_name: "Hall" }, last_updated: "2026-08-21T12:00:00Z" },
];

interface CallRecord {
  url: string;
  body: Record<string, unknown>;
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
    if (u.endsWith("/api/ha/call-service") || u.endsWith("/api/ha/alarm")) {
      calls.push({ url: u, body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
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

function findRow(root: HTMLElement, text: string): HTMLElement {
  const row = Array.from(root.querySelectorAll('[role="button"]')).find((r) => (r.textContent || "").includes(text));
  if (!row) throw new Error(`row ${text} not found`);
  return row as HTMLElement;
}

describe("Home widgets (Home Assistant)", () => {
  beforeEach(() => {
    _resetHAStateForTests();
    mockCurrentUser.role = "parent";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("HomeSecurityWidget shows presence, open sensors, and arms the alarm behind a PIN modal", async () => {
    const { calls } = stubFetch();
    const el = render(<HomeSecurityWidget />);
    await settle();

    expect(el.textContent).toContain("Jeffery");
    expect(el.textContent).toContain("Rebecca");
    expect(el.textContent).toContain("1 home");
    expect(el.textContent).toContain("Front door");

    act(() => findButton(el, /Arm home/).click());
    await settle();

    // No request until a PIN is confirmed — arm/disarm is human-only.
    expect(calls).toHaveLength(0);

    const pinInput = el.querySelector('input[type="password"]') as HTMLInputElement;
    expect(pinInput).toBeTruthy();
    const setNativeValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    act(() => {
      setNativeValue.call(pinInput, "1234");
      pinInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    act(() => findButton(el, /Confirm Arm home/).click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/api/ha/alarm")).toBe(true);
    expect(calls[0].body).toEqual({
      action: "arm_home",
      entity_id: "alarm_control_panel.alarm",
      pin: "1234",
    });
  });

  it("HomeClimateWidget shows the rounded temperature and raises the setpoint by 1", async () => {
    const { calls } = stubFetch();
    const el = render(<HomeClimateWidget />);
    await settle();

    expect(el.textContent).toContain("22°");
    expect(el.textContent).toContain("heat");
    expect(el.textContent).toContain("Humidity 44%");

    const plus = el.querySelector('button[aria-label="Increase target temperature"]') as HTMLButtonElement | null;
    expect(plus).toBeTruthy();
    act(() => plus!.click());
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      domain: "climate",
      service: "set_temperature",
      serviceData: { entity_id: "climate.living_room", temperature: 22 },
    });
  });

  it("HomeLightsWidget toggles rows and turns everything off with all entity ids", async () => {
    const { calls } = stubFetch();
    const el = render(<HomeLightsWidget />);
    await settle();

    expect(el.textContent).toContain("Kitchen");
    expect(el.textContent).toContain("Hall");
    expect(el.textContent).toContain("On");
    expect(el.textContent).toContain("Off");

    act(() => findRow(el, "Kitchen").click());
    await settle();
    expect(
      calls.some(
        (c) =>
          c.body.domain === "light" &&
          c.body.service === "toggle" &&
          (c.body.serviceData as { entity_id?: string } | undefined)?.entity_id === "light.kitchen"
      )
    ).toBe(true);

    const allOff = findButton(el, /Turn all off/);
    act(() => allOff.click());
    await settle();

    const offCall = calls.find((c) => c.body.service === "turn_off");
    expect(offCall?.body).toEqual({
      domain: "light",
      service: "turn_off",
      serviceData: { entity_id: ["light.kitchen", "light.hall"] },
    });
  });

  it("HomeSecurityWidget hides the Arm home/Disarm button for a child user", async () => {
    mockCurrentUser.role = "child";
    const { calls } = stubFetch();
    const el = render(<HomeSecurityWidget />);
    await settle();

    expect(el.textContent).toContain("disarmed");
    const controls = Array.from(el.querySelectorAll("button")).filter((b) => /Arm home|Disarm/.test(b.textContent || ""));
    expect(controls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("HomeClimateWidget hides the setpoint stepper for a child user", async () => {
    mockCurrentUser.role = "child";
    const { calls } = stubFetch();
    const el = render(<HomeClimateWidget />);
    await settle();

    expect(el.textContent).toContain("22°");
    expect(el.querySelector('button[aria-label="Increase target temperature"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Decrease target temperature"]')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("HomeLightsWidget rows are non-interactive and Turn all off is hidden for a child user", async () => {
    mockCurrentUser.role = "child";
    const { calls } = stubFetch();
    const el = render(<HomeLightsWidget />);
    await settle();

    expect(el.textContent).toContain("Kitchen");
    expect(el.textContent).toContain("Hall");
    expect(el.textContent).not.toContain("Turn all off");

    const kitchenRow = Array.from(el.querySelectorAll("div")).find(
      (d) => d.className.includes("rounded-2xl") && (d.textContent || "").includes("Kitchen")
    );
    expect(kitchenRow).toBeTruthy();
    expect(kitchenRow!.getAttribute("role")).toBeNull();
    act(() => kitchenRow!.click());
    await settle();
    expect(calls.some((c) => c.body.service === "toggle")).toBe(false);
  });
});

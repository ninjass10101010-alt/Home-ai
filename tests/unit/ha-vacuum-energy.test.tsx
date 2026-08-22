// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import VacuumCard from "@/components/ha/VacuumCard";
import EnergyCard from "@/components/ha/EnergyCard";
import { _resetHAStateForTests } from "@/hooks/useHAState";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockCurrentUser = vi.hoisted(() => ({ role: "parent" as string }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}));

const SYNC_STATES = [
  {
    entity_id: "vacuum.yeedi",
    state: "docked",
    attributes: { friendly_name: "Yeedi", battery_level: 87 },
    last_updated: "2026-08-21T12:00:00Z",
  },
  {
    entity_id: "sensor.home_power",
    state: "1250.4",
    attributes: { device_class: "power", unit_of_measurement: "W", friendly_name: "Home power" },
    last_updated: "2026-08-21T12:00:00Z",
  },
  {
    entity_id: "sensor.energy_today",
    state: "12.4",
    attributes: { device_class: "energy", unit_of_measurement: "kWh", friendly_name: "Energy today" },
    last_updated: "2026-08-21T12:00:00Z",
  },
];

function stubFetch() {
  const calls: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/api/ha/sync")) {
        return { ok: true, status: 200, json: async () => ({ success: true, count: SYNC_STATES.length, states: SYNC_STATES }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, result: {} }) };
    })
  );
  return calls;
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

function findButton(root: HTMLElement, label: RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => label.test(b.getAttribute("aria-label") || ""));
  if (!btn) throw new Error(`button ${label} not found`);
  return btn as HTMLButtonElement;
}

describe("VacuumCard", () => {
  beforeEach(() => {
    _resetHAStateForTests();
    mockCurrentUser.role = "parent";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows docked state and battery, and starts cleaning via vacuum.start", async () => {
    const calls = stubFetch();
    const el = render(<VacuumCard />);
    await settle();

    expect(el.textContent).toContain("Docked");
    expect(el.textContent).toContain("Battery 87%");
    expect(el.textContent).toContain("Yeedi");

    act(() => findButton(el, /Start vacuum cleaning/).click());
    await settle();

    expect(calls.some((c) => c.url.endsWith("/api/ha/call-service") && (c.body as any)?.domain === "vacuum" && (c.body as any)?.service === "start")).toBe(true);
  });

  it("renders nothing without a vacuum entity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, count: 0, states: [] }) }))
    );
    const el = render(<VacuumCard />);
    await settle();
    expect(el.querySelector(".widget-card")).toBeNull();
  });

  it("hides control buttons for kids but keeps status", async () => {
    mockCurrentUser.role = "child";
    stubFetch();
    const el = render(<VacuumCard />);
    await settle();

    expect(el.textContent).toContain("Docked");
    expect(el.querySelector('button[aria-label="Start vacuum cleaning"]')).toBeNull();
    expect(el.textContent).toContain("Read-only for kids");
  });
});

describe("EnergyCard", () => {
  beforeEach(() => {
    _resetHAStateForTests();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows the biggest power draw and tracked kWh", async () => {
    stubFetch();
    const el = render(<EnergyCard />);
    await settle();

    expect(el.textContent).toContain("1,250");
    expect(el.textContent).toContain("Home power");
    expect(el.textContent).toContain("12.4 kWh tracked");
  });

  it("shows the empty state when no energy sensors exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, count: 0, states: [] }) }))
    );
    const el = render(<EnergyCard />);
    await settle();

    expect(el.textContent).toContain("Add a smart plug to see live energy ⚡");
  });
});

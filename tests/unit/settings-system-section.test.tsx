// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    hydrated: true as boolean | undefined,
    currentUser: { role: "parent" as string },
  },
  pushLocalToPB: vi.fn(async () => [] as Array<{ collection: string; pushed: number; errors: number }>),
  selectMembersDetailed: vi.fn(() => [{ name: "Fallback", role: "parent", pin: "9999" }]),
  selectEmergencyContacts: vi.fn(() => [{ name: "Fallback contact" }]),
  layout: {
    mounted: true,
    config: {
      phone: { widgets: ["weather"], hidden: [] },
      tablet: { widgets: ["weather"], hidden: [] },
      desktop: { widgets: ["weather"], hidden: [] },
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/push-local-to-pb", () => ({
  pushLocalToPB: mocks.pushLocalToPB,
}));

vi.mock("@/db", () => ({
  db: {
    selectMembersDetailed: mocks.selectMembersDetailed,
    selectEmergencyContacts: mocks.selectEmergencyContacts,
  },
}));

vi.mock("@/hooks/useHomeLayout", () => ({
  useHomeLayout: () => mocks.layout,
}));

import SystemSettingsSection from "@/components/settings/SystemSettingsSection";

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

function jsonResponse(body: Record<string, unknown>, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function dialog(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!result) throw new Error("Dialog not found");
  return result;
}

function installExportFetch(options: {
  membersOk?: boolean;
  membersBody?: Record<string, unknown>;
  contactsSource?: string;
  contactsBody?: Record<string, unknown>;
} = {}) {
  let exportedBlob: Blob | null = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/members/admin")) {
      return jsonResponse(
        options.membersBody ?? { source: "live", members: [{ id: "m1", name: "Rebecca", role: "parent", emoji: "👩", pin: "1234" }] },
        options.membersOk ?? true,
        options.membersOk === false ? 503 : 200,
      );
    }
    if (url.includes("/api/emergency-contacts")) {
      return jsonResponse(options.contactsBody ?? {
        contacts: [{ id: "c1", name: "Taylor", phone: "+15551234567", email: "taylor@example.com" }],
        contactsSource: options.contactsSource ?? "live",
      });
    }
    return jsonResponse({ ok: true });
  }));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((value: Blob) => {
      exportedBlob = value;
      return "blob:family-settings";
    }),
    revokeObjectURL: vi.fn(),
  });
  return () => exportedBlob;
}

beforeEach(() => {
  mocks.auth.hydrated = true;
  mocks.auth.currentUser.role = "parent";
  mocks.pushLocalToPB.mockReset();
  mocks.pushLocalToPB.mockResolvedValue([]);
  mocks.selectMembersDetailed.mockClear();
  mocks.selectEmergencyContacts.mockClear();
  mocks.layout.mounted = true;
  mocks.layout.config = {
    phone: { widgets: ["weather"], hidden: [] },
    tablet: { widgets: ["weather"], hidden: [] },
    desktop: { widgets: ["weather"], hidden: [] },
  };
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/services/config")) return jsonResponse({ services: [] });
    if (url.endsWith("/api/ai/providers")) return jsonResponse({ providers: [], envProviders: [], active: null });
    if (url.endsWith("/api/ai/health")) return jsonResponse({ outcomes: [], summary: { total: 0, ok: 0, wrapup: 0, exhausted: 0, snag: 0, clientGone: 0, unconfigured: 0, avgMs: 0, lastFailure: null } });
    if (url.endsWith("/api/muse/settings")) return jsonResponse({ enabled: false, adminEnabled: false, keyPrefix: null, version: 0, createdAt: null, rotatedAt: null, lastUsedAt: null, rateLimitPerMin: 120, hasKey: false });
    if (url.endsWith("/api/muse/log?limit=20")) return jsonResponse({ entries: [] });
    if (url.endsWith("/api/google/state")) return jsonResponse({ connected: false, revoked_at: null });
    if (url.endsWith("/api/google/sync-state")) return jsonResponse({ ok: true, calendar_last_sync_at: null });
    if (url.endsWith("/api/google/calendars")) return jsonResponse({ ok: true, calendars: [] });
    if (url.endsWith("/api/ha/notify-targets")) return jsonResponse({ ok: true, telegramAvailable: false, targets: [] });
    if (url.endsWith("/api/ha/notify-prefs")) return jsonResponse({ ok: true, prefs: { briefing: false, weather: false, calendar: false } });
    if (url.endsWith("/api/admin/version")) return jsonResponse({ ok: true, built_at: { hash: "local", short: "local", message: "Local", date: "2026-09-21T00:00:00.000Z" }, latest_remote: null, update_available: false, commits_behind: 0 });
    return jsonResponse({ ok: true });
  }));
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemSettingsSection", () => {
  it("renders parent integrations as siblings under one h2 group and keeps data rows flat", async () => {
    const host = render(<SystemSettingsSection />);
    await settle();

    expect(host.querySelector('[data-settings-system="true"]')).toBeTruthy();
    expect(host.querySelector("h2")?.textContent).toBe("Integrations");
    const group = host.querySelector<HTMLElement>('[data-settings-integrations="true"]')!;
    expect(Array.from(group.children).map((child) => child.classList.contains("widget-card"))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(group.querySelectorAll(":scope > .widget-card")).toHaveLength(5);
    expect(host.querySelectorAll(".widget-card .widget-card")).toHaveLength(0);

    const rows = host.querySelectorAll('[data-settings-data-row="true"]');
    expect(rows).toHaveLength(2);
    expect(Array.from(rows).every((row) => row.className.includes("min-h-20"))).toBe(true);
    expect(host.textContent).not.toMatch(/cloud|pocketbase|\bPB\b/i);
  });

  it("states the safe household-only push scope before confirmation", async () => {
    const host = render(<SystemSettingsSection />);
    await settle();

    expect(host.textContent).toContain("grocery, pantry, meals, recipes, events, and routines");
    expect(host.textContent).toContain("Tasks, points, and family goals stay on the family server");
    await act(async () => button(host, /Push local data to family server/).click());
    expect(dialog().textContent).toContain("Tasks, points, and family goals are not included");
  });

  it("waits for auth hydration before mounting parent controls", async () => {
    mocks.auth.hydrated = false;
    const loading = render(<SystemSettingsSection />);
    await settle();

    expect(loading.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(loading.textContent).toContain("Checking system settings");
    expect(loading.querySelector('[data-settings-integrations="true"]')).toBeNull();

    mocks.auth.hydrated = true;
    const ready = render(<SystemSettingsSection />);
    await settle();
    expect(ready.querySelector('[data-settings-integrations="true"]')).toBeTruthy();
  });
  it("treats an undefined hydration flag as unhydrated", async () => {
    mocks.auth.hydrated = undefined;
    const host = render(<SystemSettingsSection />);
    await settle();

    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(host.querySelector('[data-settings-integrations="true"]')).toBeNull();
  });
  it("does not render the parent-only view for child, pet, guest, or non-exact parent roles", async () => {
    for (const role of ["child", "pet", "guest", "Parent", ""]) {
      mocks.auth.currentUser.role = role;
      const host = render(<SystemSettingsSection />);
      await settle();
      expect(host.textContent).toBe("");
      expect(host.querySelector('[data-settings-system="true"]')).toBeNull();
    }
    expect(mocks.pushLocalToPB).not.toHaveBeenCalled();
  });

  it("exports authoritative sanitized members and the effective shared layout", async () => {
    const getBlob = installExportFetch();
    mocks.layout.config = {
      phone: { widgets: ["weather"], hidden: [] },
      tablet: { widgets: ["tasks"], hidden: [] },
      desktop: { widgets: ["weather"], hidden: [] },
    };
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Export JSON/).click());
    await settle();

    const blob = getBlob();
    expect(blob).toBeTruthy();
    const exported = JSON.parse(await blob!.text());
    expect(exported.members).toEqual([{ id: "m1", name: "Rebecca", role: "parent", emoji: "👩" }]);
    expect(exported.source).toEqual({ members: "live", contacts: "live", layout: "home-layout" });
    expect(exported.contacts).toEqual([
      { id: "c1", name: "Taylor", phone: "+15551234567", email: "taylor@example.com" },
    ]);
    expect(Object.keys(exported.layout).sort()).toEqual(["desktop", "phone", "tablet"]);
    for (const mode of ["phone", "tablet", "desktop"]) {
      expect(Array.isArray(exported.layout[mode].widgets)).toBe(true);
      expect(Array.isArray(exported.layout[mode].hidden)).toBe(true);
    }
    expect(JSON.stringify(exported)).not.toContain("pin");
    expect(mocks.selectMembersDetailed).not.toHaveBeenCalled();
    expect(mocks.selectEmergencyContacts).not.toHaveBeenCalled();
  });

  it("rejects empty, partial, or malformed live member and contact rosters", async () => {
    const cases = [
      { membersBody: { source: "live", members: [] } },
      { membersBody: { source: "live", members: [{ id: "m1" }] } },
      { contactsBody: { contacts: [{ name: "Missing fields" }], contactsSource: "live" } },
    ];
    for (const options of cases) {
      const getBlob = installExportFetch(options);
      const host = render(<SystemSettingsSection />);
      await settle();
      await act(async () => button(host, /Export JSON/).click());
      await settle();
      expect(getBlob()).toBeNull();
      expect(host.textContent).toContain("Couldn't export family settings");
    }
  });
  it("accepts an explicitly live empty contacts roster", async () => {
    const getBlob = installExportFetch({ contactsBody: { contacts: [], contactsSource: "live" } });
    const host = render(<SystemSettingsSection />);
    await settle();
    await act(async () => button(host, /Export JSON/).click());
    await settle();

    const blob = getBlob();
    expect(blob).toBeTruthy();
    expect(JSON.parse(await blob!.text()).contacts).toEqual([]);
  });
  it("does not claim export success when authoritative member or contact data is unavailable", async () => {
    const getBlob = installExportFetch({ membersOk: false });
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Export JSON/).click());
    await settle();

    expect(getBlob()).toBeNull();
    expect(host.textContent).toContain("Couldn't export family settings");
    expect(host.textContent).toContain("Try again");
  });

  it("does not export cache-backed contacts or malformed layout data", async () => {
    const getBlob = installExportFetch({ contactsSource: "cache" });
    mocks.layout.config = { phone: "malformed" } as any;
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Export JSON/).click());
    await settle();

    expect(getBlob()).toBeNull();
    expect(host.textContent).toContain("Couldn't export family settings");
  });
  it("guards rapid duplicate export confirmations with one synchronous request", async () => {
    installExportFetch();
    const fetchMock = vi.mocked(fetch);
    const host = render(<SystemSettingsSection />);
    await settle();
    const exportButton = button(host, /Export JSON/);

    await act(async () => {
      exportButton.click();
      exportButton.click();
    });
    await settle();

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/members/admin"))).toHaveLength(1);
  });
  it("confirms before pushing local data and reports the typed result honestly", async () => {
    mocks.pushLocalToPB.mockResolvedValue([
      { collection: "grocery", pushed: 2, errors: 0 },
      { collection: "events", pushed: 1, errors: 1 },
    ]);
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Push local data to family server/).click());
    expect(mocks.pushLocalToPB).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("family server");
     expect(dialog().textContent).toContain("Tasks, points, and family goals are not included");

    await act(async () => button(dialog(), /Push data/).click());
    await settle();

    expect(mocks.pushLocalToPB).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Pushed 3 household items");
    expect(host.textContent).toContain("1 item needs attention");
    expect(host.querySelector('[role="status"]')?.className).toContain("var(--color-accent-rose)");
  });

  it("guards duplicate push confirmations while the family-server push is pending", async () => {
    const pending = deferred<any>();
    mocks.pushLocalToPB.mockReturnValue(pending.promise as any);
    const host = render(<SystemSettingsSection />);
    await settle();
    await act(async () => button(host, /Push local data to family server/).click());
    const confirm = button(dialog(), /Push data/);
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(mocks.pushLocalToPB).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve([{ collection: "family data", pushed: 1, errors: 0 }]);
      await Promise.resolve();
    });
    await settle();
  });
  it("rejects malformed dynamic push counts instead of reporting zero or coerced success", async () => {
    mocks.pushLocalToPB.mockResolvedValue([
      { collection: "family data", pushed: "1", errors: 0 },
    ] as any);
    const host = render(<SystemSettingsSection />);
    await settle();
    await act(async () => button(host, /Push local data to family server/).click());
    await act(async () => button(dialog(), /Push data/).click());
    await settle();

    expect(host.textContent).toContain("Couldn't push this device's data");
    expect(host.textContent).not.toContain("Pushed 1 household item");
  });
  it("reports an all-failed push with zero successes and the exact error count", async () => {
    mocks.pushLocalToPB.mockResolvedValue([
      { collection: "family data", pushed: 0, errors: 6 },
      { collection: "family_goals", pushed: 0, errors: 1 },
    ]);
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Push local data to family server/).click());
    await act(async () => button(dialog(), /Push data/).click());
    await settle();

    expect(host.textContent).toContain("Pushed 0 household items");
    expect(host.textContent).toContain("7 items need attention");
    expect(host.textContent).not.toContain("6 collections");
    expect(host.querySelector('[role="status"]')?.className).toContain("var(--color-accent-rose)");
  });

  it("catches a failed family-server push and reports an error without an unhandled rejection", async () => {
    mocks.pushLocalToPB.mockRejectedValueOnce(new Error("family server unavailable"));
    const host = render(<SystemSettingsSection />);
    await settle();

    await act(async () => button(host, /Push local data to family server/).click());
    await act(async () => button(dialog(), /Push data/).click());
    await settle();

    expect(host.textContent).toContain("Couldn't push this device's data");
    expect(host.textContent).toContain("Try again");
  });
});

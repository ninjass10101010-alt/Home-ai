// Task 14 — chat calendar tools on the Composio provider.
//
// The contract under test:
//   - `add_event` keeps writing the family `events` row exactly as before and
//     THEN mirrors it to the connected Google calendar (best-effort). A Google
//     failure never fails the PB write; the tool reports the partial result
//     honestly. No Google account connected = family-only, no error.
//   - `remove_event` routes by origin: a family row deletes from PocketBase as
//     before; a Google-cache row deletes through Composio and only then prunes
//     its cache row.
//   - `get_week_events` groups the next 7 days from the two caches with no
//     live Composio call.
//   - the suggestion engine's conflict scan covers the same 7-day cache window.
//
// The Composio boundary is mocked at `@/lib/google/composio`, so the real
// `createCalendarEvent`/`deleteCalendarEvent` mapping and connection-state
// gate are exercised end to end (no network).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
const failCollections = new Set<string>();
const { executeComposioAction } = vi.hoisted(() => ({ executeComposioAction: vi.fn() }));

vi.mock("@/lib/google/composio", () => ({
  executeComposioAction: (...args: unknown[]) => executeComposioAction(...args),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => {
        if (failCollections.has(name)) throw new Error(`${name} unavailable`);
        return rows[name] ?? [];
      },
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => { writes.push({ op: "update", collection: name, id, data: d }); return { id, ...d }; },
      create: async (d: any) => { writes.push({ op: "create", collection: name, data: d }); return { id: "n1", ...d }; },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));

vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));

import { getTool } from "@/lib/hermes-tools";
import { scanCalendarConflicts } from "@/lib/consuela/engine";
import { COMPOSIO_ACTIONS } from "@/lib/google/composio-actions";

const CONNECTED_SNAPSHOT = {
  id: "s1",
  key: "google_composio_connection",
  data: { connectedAccountId: "ca_1", status: "ACTIVE" },
};
const CREATE_OK = { successful: true, data: { id: "g_evt_1", summary: "Soccer practice" } };
const DELETE_OK = { successful: true, data: {} };
const GOOGLE_ROW = {
  id: "gr1",
  google_id: "g1",
  summary: "Field Trip",
  start_iso: "2026-09-11T09:00:00-04:00",
  end_iso: "2026-09-11T15:00:00-04:00",
  all_day: false,
  calendar_id: "primary",
};

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  failCollections.clear();
  executeComposioAction.mockReset();
  executeComposioAction.mockResolvedValue(CREATE_OK);
  rows.consuela_data_snapshots = [{ ...CONNECTED_SNAPSHOT }];
  vi.useFakeTimers({ now: new Date("2026-09-10T12:00:00") });
});
afterEach(() => vi.useRealTimers());

describe("add_event — dual-write with best-effort Google leg", () => {
  it("saves the family row, then mirrors it to the connected Google calendar", async () => {
    const out = JSON.parse(await getTool("add_event")!.handler({
      title: "Soccer practice", date: "2026-09-12", time: "17:30", member: "Rebecca",
    }));

    expect(out.ok).toBe(true);
    expect(writes.some((w) =>
      w.op === "create" && w.collection === "events" && w.data.title === "Soccer practice"
    )).toBe(true);

    expect(executeComposioAction).toHaveBeenCalledTimes(1);
    const [action, args, accountId] = executeComposioAction.mock.calls[0];
    expect(action).toBe(COMPOSIO_ACTIONS.CREATE_EVENT);
    expect(args).toMatchObject({
      calendar_id: "primary",
      summary: "Soccer practice",
      start_datetime: "2026-09-12T17:30:00",
      event_duration_hour: 1,
      event_duration_minutes: 0,
    });
    expect(accountId).toBe("ca_1");
    expect(out.google).toBe("created");
    expect(out.warning).toBeUndefined();
    expect(out.error).toBeUndefined();
  });

  it("mirrors a 12-hour stored time as the same family-local wall clock", async () => {
    await getTool("add_event")!.handler({ title: "Recital", date: "2026-09-13", time: "7:00 PM" });

    const [, args] = executeComposioAction.mock.calls[0];
    expect(args.start_datetime).toBe("2026-09-13T19:00:00");
  });

  it("a Google failure never fails the family write and is reported honestly", async () => {
    executeComposioAction.mockRejectedValue(
      Object.assign(new Error("Composio error (500)"), { code: "api_error", status: 500 })
    );

    const out = JSON.parse(await getTool("add_event")!.handler({
      title: "Dentist", date: "2026-09-12", time: "09:00",
    }));

    expect(out.ok).toBe(true);
    expect(out.event.title).toBe("Dentist");
    expect(writes.some((w) => w.op === "create" && w.collection === "events")).toBe(true);
    expect(out.google).toBe("failed");
    expect(out.warning).toContain("saved to the family calendar");
    expect(out.warning).toContain("Google Calendar update failed");
    expect(out.warning).toContain("Composio error (500)");
  });

  it("with no Google account connected it saves family-only and reports no error", async () => {
    rows.consuela_data_snapshots = [];

    const out = JSON.parse(await getTool("add_event")!.handler({
      title: "Pizza night", date: "2026-09-12", time: "18:00",
    }));

    expect(out.ok).toBe(true);
    expect(executeComposioAction).not.toHaveBeenCalled();
    expect(out.google).toBe("not_connected");
    expect(out.warning).toBeUndefined();
    expect(out.error).toBeUndefined();
  });
});

describe("remove_event — origin routing", () => {
  it("deletes a family-origin row from PocketBase exactly as before", async () => {
    rows.events = [{ id: "e1", title: "Dentist", date: "2026-09-12", time: "15:00" }];

    const out = JSON.parse(await getTool("remove_event")!.handler({
      title: "Dentist", date: "2026-09-12",
    }));

    expect(out.removed).toBe(true);
    expect(out.source).toBe("family");
    expect(writes.some((w) => w.op === "delete" && w.collection === "events" && w.id === "e1")).toBe(true);
    expect(executeComposioAction).not.toHaveBeenCalled();
  });

  it("deletes a Google-origin row through Composio, then prunes its cache row", async () => {
    rows.events = [];
    rows.consuela_google_calendar_events = [{ ...GOOGLE_ROW }];
    executeComposioAction.mockResolvedValue(DELETE_OK);

    const out = JSON.parse(await getTool("remove_event")!.handler({
      title: "field trip", date: "2026-09-11",
    }));

    expect(out.removed).toBe(true);
    expect(out.source).toBe("google");
    const [action, args] = executeComposioAction.mock.calls[0];
    expect(action).toBe(COMPOSIO_ACTIONS.DELETE_EVENT);
    expect(args).toMatchObject({ calendar_id: "primary", event_id: "g1" });
    expect(writes.some((w) =>
      w.op === "delete" && w.collection === "consuela_google_calendar_events" && w.id === "gr1"
    )).toBe(true);
  });

  it("refuses honestly when the Google delete fails and never prunes the cache", async () => {
    rows.events = [];
    rows.consuela_google_calendar_events = [{ ...GOOGLE_ROW }];
    executeComposioAction.mockRejectedValue(
      Object.assign(new Error("Composio error (500)"), { code: "api_error", status: 500 })
    );

    const out = JSON.parse(await getTool("remove_event")!.handler({ title: "Field Trip" }));

    expect(out.removed).toBe(false);
    expect(out.reason).toContain("Google Calendar delete failed");
    expect(writes.some((w) =>
      w.op === "delete" && w.collection === "consuela_google_calendar_events"
    )).toBe(false);
  });

  it("tells the truth when the cached Google row's account is not connected", async () => {
    rows.events = [];
    rows.consuela_google_calendar_events = [{ ...GOOGLE_ROW }];
    rows.consuela_data_snapshots = [];

    const out = JSON.parse(await getTool("remove_event")!.handler({ title: "Field Trip" }));

    expect(out.removed).toBe(false);
    expect(out.reason).toContain("not connected");
    expect(writes.some((w) =>
      w.op === "delete" && w.collection === "consuela_google_calendar_events"
    )).toBe(false);
  });
});

describe("get_week_events — 7-day cache read", () => {
  it("groups the next 7 days from the family + Google caches with no live Composio call", async () => {
    rows.events = [{ id: "e1", title: "Dentist", date: "2026-09-12", time: "15:00", member: "Aurora" }];
    rows.consuela_google_calendar_events = [{ ...GOOGLE_ROW }];
    rows.members = [{ name: "Aurora", fullName: "Aurora", emoji: "🧚" }];

    const out = JSON.parse(await getTool("get_week_events")!.handler({}));

    expect(Object.keys(out.days)).toEqual([
      "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
    ]);
    expect(out.days["2026-09-10"]).toEqual([]);
    expect(out.days["2026-09-11"][0].title).toBe("Field Trip");
    expect(out.days["2026-09-12"][0].title).toBe("Dentist");
    expect(executeComposioAction).not.toHaveBeenCalled();
  });

  it("says the calendar is unavailable when both cache reads fail", async () => {
    failCollections.add("events");
    failCollections.add("consuela_google_calendar_events");

    const out = JSON.parse(await getTool("get_week_events")!.handler({}));

    expect(out.error).toContain("unavailable");
    expect(out.days).toEqual({});
  });
});

describe("scanCalendarConflicts — 7-day cache window", () => {
  it("scans family + Google cache rows across the week and ignores dates outside it", async () => {
    rows.events = [
      { id: "e1", title: "Soccer", date: "2026-09-13", time: "10:00" },
      { id: "e2", title: "Piano", date: "2026-09-13", time: "10:15" },
      { id: "e3", title: "Far One", date: "2026-09-20", time: "10:00" },
      { id: "e4", title: "Far Two", date: "2026-09-20", time: "10:10" },
    ];
    rows.consuela_google_calendar_events = [
      { google_id: "g1", summary: "School Play", start_iso: "2026-09-15T18:00:00-04:00", end_iso: "2026-09-15T19:00:00-04:00", all_day: false },
      { google_id: "g2", summary: "Dinner Out", start_iso: "2026-09-15T18:10:00-04:00", end_iso: "2026-09-15T19:10:00-04:00", all_day: false },
    ];

    const out = await scanCalendarConflicts("2026-09-10");
    const titles = out.map((s) => s.title);

    expect(titles).toContain("Soccer and Piano overlap");
    expect(titles).toContain("School Play and Dinner Out overlap");
    expect(titles.some((t) => t.includes("Far One"))).toBe(false);
    expect(out.find((s) => s.title === "Soccer and Piano overlap")!.scopeDate).toBe("2026-09-13");
    expect(out.find((s) => s.title === "School Play and Dinner Out overlap")!.scopeDate).toBe("2026-09-15");
  });
});

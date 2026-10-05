import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("../../src/lib/google/composio.ts", () => ({
  executeComposioAction: mocks.execute,
}));

vi.mock("../../src/lib/pb-auth.ts", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { syncCalendar, pruneCalendar, setCalendarSelection } from "../../src/lib/google/calendar.ts";

const FAMILY = "family@gmail.com";
const ACCOUNT = "ca_test";

interface PbMockOptions {
  calRows?: any[];
  eventRows?: any[];
  connectedAccountId?: string | null;
}

function pbMock(opts: PbMockOptions = {}) {
  const calRows = opts.calRows ?? [
    { id: "cal-primary", calendar_id: "primary", summary: "Primary", selected: true, sync_token: "P_TOKEN" },
  ];
  const eventRows = opts.eventRows ?? [];
  const connectedAccountId = opts.connectedAccountId === undefined ? ACCOUNT : opts.connectedAccountId;
  const writes = {
    calUpdates: [] as any[],
    calCreates: [] as any[],
    eventCreates: [] as any[],
    eventUpdates: [] as any[],
    eventDeletes: [] as string[],
  };
  const pb = {
    collection: (name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () =>
            connectedAccountId
              ? [{ id: "snap", data: { connectedAccountId, status: "ACTIVE" } }]
              : [],
          create: async () => ({}),
          update: async () => ({}),
          delete: async () => ({}),
        };
      }
      if (name === "consuela_google_calendar_sync") {
        return {
          getFullList: async (args: any = {}) => {
            const m = /calendar_id = "([^"]*)"/.exec(args?.filter || "");
            return m ? calRows.filter((r) => r.calendar_id === m[1]) : calRows;
          },
          update: async (id: string, payload: any) => {
            writes.calUpdates.push({ id, payload });
            const row = calRows.find((r) => r.id === id);
            if (row) Object.assign(row, payload);
            return {};
          },
          create: async (payload: any) => {
            writes.calCreates.push(payload);
            calRows.push({ id: "new-cal", ...payload });
            return { id: "new-cal" };
          },
        };
      }
      if (name === "consuela_google_calendar_events") {
        return {
          getFullList: async (args: any = {}) => {
            const filter: string = args?.filter || "";
            if (!filter) return eventRows;
            if (filter.includes('calendar_id = "primary"')) {
              return eventRows.filter((r) => !r.calendar_id || r.calendar_id === "primary");
            }
            const m = /calendar_id = "([^"]*)"/.exec(filter);
            return m ? eventRows.filter((r) => r.calendar_id === m[1]) : eventRows;
          },
          create: async (row: any) => {
            writes.eventCreates.push(row);
            const created = { id: "ec" + writes.eventCreates.length, ...row };
            eventRows.push(created);
            return created;
          },
          update: async (id: string, row: any) => {
            writes.eventUpdates.push({ id, row });
            const existing = eventRows.find((r) => r.id === id);
            if (existing) Object.assign(existing, row);
            return {};
          },
          delete: async (id: string) => {
            writes.eventDeletes.push(id);
            const i = eventRows.findIndex((r) => r.id === id);
            if (i >= 0) eventRows.splice(i, 1);
            return {};
          },
        };
      }
      return {
        getFullList: async () => [],
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
      };
    },
  };

  // Mirrors what the selection PUT does outside the sync lock:
  // setCalendarSelection(selected=false) + pruneCalendar (rows gone, token gone).
  const deselectAndPrune = (calendarId: string) => {
    const row = calRows.find((r) => r.calendar_id === calendarId);
    if (row) {
      row.selected = false;
      row.sync_token = null;
      row.last_status = "pruned";
    }
    for (let i = eventRows.length - 1; i >= 0; i--) {
      const r = eventRows[i];
      const belongs =
        calendarId === "primary"
          ? !r.calendar_id || r.calendar_id === "primary"
          : r.calendar_id === calendarId;
      if (belongs) eventRows.splice(i, 1);
    }
  };

  return { pb, writes, calRows, eventRows, deselectAndPrune };
}

function ev(id: string, summary: string) {
  return {
    id,
    status: "confirmed",
    summary,
    start: { dateTime: "2026-10-06T10:00:00Z" },
    end: { dateTime: "2026-10-06T11:00:00Z" },
  };
}

function eventsEnvelope(items: any[]) {
  return { data: { items }, successful: true, error: null };
}

function composioApiError(status: number) {
  return Object.assign(new Error(`Composio error (${status})`), { code: "api_error", status });
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.withAdmin.mockReset();
});

describe("syncCalendar — multi-calendar loop (Composio)", () => {
  it("upserts two selected calendars with distinct calendar_id (same google_id is fine)", async () => {
    const { pb, writes } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async (_action: string, args: any) =>
      args.calendar_id === FAMILY
        ? eventsEnvelope([ev("shared1", "Family thing")])
        : eventsEnvelope([ev("shared1", "Primary thing")]),
    );

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar).toHaveLength(2);
    expect(outcome.perCalendar.map((c: any) => c.calendarId).sort()).toEqual([FAMILY, "primary"]);
    expect(outcome.perCalendar.every((c: any) => c.ok)).toBe(true);
    expect(outcome.events).toBe(2);
    // Composio exposes no incremental cursor — the run reports no next token.
    expect(outcome.nextSyncToken).toBeNull();

    // Two rows persisted, keyed to their own calendar despite the shared google_id
    expect(writes.eventCreates).toHaveLength(2);
    const byCal = Object.fromEntries(writes.eventCreates.map((r: any) => [r.calendar_id, r.google_id]));
    expect(byCal).toEqual({ primary: "shared1", [FAMILY]: "shared1" });

    // Each calendar is marked ok, and the dead sync_token field is not written
    const famSave = writes.calUpdates.find((u) => u.payload.calendar_id === FAMILY);
    const primSave = writes.calUpdates.find((u) => u.payload.calendar_id === "primary");
    expect(famSave.payload.last_status).toBe("ok");
    expect(primSave.payload.last_status).toBe("ok");
    expect("sync_token" in famSave.payload).toBe(false);
    expect("sync_token" in primSave.payload).toBe(false);
  });

  it("ignores persisted sync tokens — every calendar full-pulls with an explicit window", async () => {
    const { pb } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: "P_STALE" },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: "F_STALE" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async () => eventsEnvelope([]));

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar.every((c: any) => c.ok)).toBe(true);
    const callsByCalendar = new Map(
      mocks.execute.mock.calls.map((c: any) => [c[1].calendar_id, c[1]]),
    );
    expect([...callsByCalendar.keys()].sort()).toEqual([FAMILY, "primary"]);
    for (const args of callsByCalendar.values()) {
      expect(args.syncToken).toBeUndefined();
      expect(args.time_min).toBeTruthy();
      expect(args.time_max).toBeTruthy();
    }
  });

  it("isolates one calendar's failure — the other still syncs, last_error recorded", async () => {
    const { pb, writes } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async (_action: string, args: any) => {
      if (args.calendar_id === FAMILY) throw composioApiError(503);
      return eventsEnvelope([ev("p1", "Primary thing")]);
    });

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar).toHaveLength(2);
    const fam = outcome.perCalendar.find((c: any) => c.calendarId === FAMILY);
    const prim = outcome.perCalendar.find((c: any) => c.calendarId === "primary");
    expect(prim.ok).toBe(true);
    expect(prim.events).toBe(1);
    expect(fam.ok).toBe(false);
    expect(fam.error).toContain("503");
    expect(outcome.events).toBe(1);

    const famErr = writes.calUpdates.find((u) => u.id === "cf" && u.payload.last_status === "error");
    expect(famErr.payload.last_error).toContain("503");
    expect(writes.calUpdates.find((u) => u.id === "cf" && u.payload.last_status === "ok")).toBeUndefined();
  });

  it("full-pulls a newly selected calendar and a previously-tokened calendar the same way", async () => {
    const { pb } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: "P_TOKEN" },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async () => eventsEnvelope([]));

    await syncCalendar();

    const famCall = mocks.execute.mock.calls.find((c: any) => c[1].calendar_id === FAMILY)!;
    const primCall = mocks.execute.mock.calls.find((c: any) => c[1].calendar_id !== FAMILY)!;
    expect(famCall[1].time_min).toBeTruthy();
    expect(famCall[1].syncToken).toBeUndefined();
    expect(primCall[1].time_min).toBeTruthy();
    expect(primCall[1].syncToken).toBeUndefined();
  });

  it("defaults to primary-only when nothing is opted in (backward compatible)", async () => {
    const { pb } = pbMock({ calRows: [] });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue(eventsEnvelope([ev("p1", "Thing")]));

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar).toHaveLength(1);
    expect(outcome.perCalendar[0].calendarId).toBe("primary");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][1].calendar_id).toBe("primary");
  });

  it("honors an explicit deselect-all (rows exist, none selected → no Composio calls)", async () => {
    const { pb } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: false, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: false, sync_token: null },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar).toHaveLength(0);
    expect(outcome.events).toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("syncCalendar — deselect landing mid-sync (PUT is not lock-covered)", () => {
  it("a deselect during the calendar's own pull does not resurrect rows or re-save the token", async () => {
    const { pb, calRows, eventRows, deselectAndPrune } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
      eventRows: [{ id: "e-old", calendar_id: FAMILY, google_id: "old1" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async (_action: string, args: any) => {
      if (args.calendar_id === FAMILY) {
        // The selection PUT lands WHILE this calendar's pull is in flight:
        // selected=false committed + prune already ran.
        deselectAndPrune(FAMILY);
        return eventsEnvelope([ev("f1", "Family thing")]);
      }
      return eventsEnvelope([ev("p1", "Primary thing")]);
    });

    const outcome = (await syncCalendar()) as any;

    // The in-flight sync must not leave ghost rows behind for the deselected
    // calendar…
    expect(eventRows.filter((r: any) => r.calendar_id === FAMILY)).toHaveLength(0);
    // …nor re-save its sync token.
    const famRow = calRows.find((r: any) => r.calendar_id === FAMILY)!;
    expect(famRow.selected).toBe(false);
    expect(famRow.sync_token).toBeNull();
    // The still-selected calendar is unaffected.
    const primRow = calRows.find((r: any) => r.calendar_id === "primary")!;
    expect(primRow.last_status).toBe("ok");
    expect(outcome.perCalendar.find((c: any) => c.calendarId === FAMILY).events).toBe(0);
  });

  it("a deselect before the calendar's turn skips it entirely — no Composio call, no writes", async () => {
    const { pb, writes, calRows, eventRows, deselectAndPrune } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
      eventRows: [{ id: "e-old", calendar_id: FAMILY, google_id: "old1" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async (_action: string, args: any) => {
      if (args.calendar_id !== FAMILY) {
        // Deselect lands after the selected list was captured but before
        // Family's syncOneCalendar starts.
        deselectAndPrune(FAMILY);
        return eventsEnvelope([ev("p1", "Primary thing")]);
      }
      return eventsEnvelope([]);
    });

    const outcome = (await syncCalendar()) as any;

    const famCalls = mocks.execute.mock.calls.filter((c: any) => c[1].calendar_id === FAMILY);
    expect(famCalls).toHaveLength(0);
    expect(writes.eventCreates.filter((r: any) => r.calendar_id === FAMILY)).toHaveLength(0);
    expect(writes.calUpdates.find((u: any) => u.id === "cf")).toBeUndefined();
    expect(eventRows.filter((r: any) => r.calendar_id === FAMILY)).toHaveLength(0);
    expect(outcome.perCalendar.map((c: any) => c.calendarId)).toEqual(["primary"]);
    expect(calRows.find((r: any) => r.calendar_id === "primary")!.last_status).toBe("ok");
  });
});

describe("pruneCalendar (deselection cleanup)", () => {
  it("deletes the calendar's cached rows and clears its sync token", async () => {
    const { pb, writes } = pbMock({
      calRows: [
        { id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: "P_TOKEN" },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: false, sync_token: "F_TOKEN" },
      ],
      eventRows: [
        { id: "e1", calendar_id: FAMILY, google_id: "f1" },
        { id: "e2", calendar_id: FAMILY, google_id: "f2" },
        { id: "e3", calendar_id: "primary", google_id: "p1" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const result = await pruneCalendar(FAMILY);

    expect(result.deleted).toBe(2);
    expect(writes.eventDeletes.sort()).toEqual(["e1", "e2"]);
    const stateClear = writes.calUpdates.find((u) => u.id === "cf");
    expect(stateClear.payload.sync_token).toBeNull();
  });

  it("pruning primary also removes legacy rows with an empty calendar_id", async () => {
    const { pb, writes } = pbMock({
      calRows: [{ id: "cp", calendar_id: "primary", summary: "Primary", selected: true, sync_token: "P_TOKEN" }],
      eventRows: [
        { id: "e1", calendar_id: "", google_id: "legacy1" },
        { id: "e2", calendar_id: "primary", google_id: "p1" },
        { id: "e3", calendar_id: FAMILY, google_id: "f1" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const result = await pruneCalendar("primary");

    expect(result.deleted).toBe(2);
    expect(writes.eventDeletes.sort()).toEqual(["e1", "e2"]);
  });
});

describe("setCalendarSelection — re-select forces a full pull", () => {
  it("clears a stale sync_token on a false→true transition (race residue can't resume incrementally)", async () => {
    const { pb, writes } = pbMock({
      calRows: [{ id: "cf", calendar_id: FAMILY, summary: "Fam", selected: false, sync_token: "STALE" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const { wasSelected } = await setCalendarSelection({ calendarId: FAMILY, selected: true });

    expect(wasSelected).toBe(false);
    const update = writes.calUpdates.find((u) => u.id === "cf");
    expect(update.payload.selected).toBe(true);
    expect(update.payload.sync_token).toBeNull();
  });

  it("keeps the token when re-saving an already-selected calendar (no-op PUT must not force re-pulls)", async () => {
    const { pb, writes } = pbMock({
      calRows: [{ id: "cf", calendar_id: FAMILY, summary: "Fam", selected: true, sync_token: "LIVE" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    const { wasSelected } = await setCalendarSelection({ calendarId: FAMILY, selected: true, summary: "Renamed" });

    expect(wasSelected).toBe(true);
    const update = writes.calUpdates.find((u) => u.id === "cf");
    expect(update.payload.sync_token).toBeUndefined();
    expect(update.payload.summary).toBe("Renamed");
  });
});

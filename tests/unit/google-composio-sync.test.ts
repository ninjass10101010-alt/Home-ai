import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "../fixtures/composio-contract.json";

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

import {
  syncCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listCalendars,
} from "../../src/lib/google/calendar.ts";
import { GoogleAuthError } from "../../src/lib/google/connection-state.ts";

const PRIMARY = "primary";
const FAMILY = "family@group.calendar.google.com";
const ACCOUNT = "ca_test";

function envelope(data: unknown) {
  return { data, successful: true, error: null };
}

function composioApiError(status = 500) {
  return Object.assign(new Error(`Composio error (${status})`), { code: "api_error", status });
}

function composioAuthError(status = 401) {
  return Object.assign(new Error(`Composio auth failed (${status})`), { code: "auth_failed", status });
}

function event(id: string, summary: string) {
  return {
    id,
    status: "confirmed",
    summary,
    start: { dateTime: "2026-10-06T10:00:00Z" },
    end: { dateTime: "2026-10-06T11:00:00Z" },
  };
}

interface PbMockOptions {
  calRows?: any[];
  eventRows?: any[];
  connectedAccountId?: string | null;
}

function pbMock(opts: PbMockOptions = {}) {
  const calRows = opts.calRows ?? [
    { id: "cp", calendar_id: PRIMARY, summary: "Primary", selected: true, sync_token: null },
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
  return { pb, writes, calRows, eventRows };
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.withAdmin.mockReset();
});

describe("syncCalendar — Composio EVENTS_LIST", () => {
  it("maps a Composio EVENTS_LIST envelope to normalized event rows with an explicit window", async () => {
    const { pb, writes } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValueOnce(fixture.executeListEvents);

    const outcome = (await syncCalendar()) as any;

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [action, args, accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_EVENTS_LIST");
    expect(accountId).toBe(ACCOUNT);
    expect(args.calendar_id).toBe(PRIMARY);
    expect(typeof args.time_min).toBe("string");
    expect(typeof args.time_max).toBe("string");
    expect(Date.parse(args.time_min)).toBeLessThan(Date.now());
    expect(Date.parse(args.time_max)).toBeGreaterThan(Date.now());

    expect(outcome.events).toBe(2);
    expect(writes.eventCreates).toHaveLength(2);
    const alpha = writes.eventCreates.find((r: any) => r.google_id === "evt_alpha");
    expect(alpha).toMatchObject({
      calendar_id: PRIMARY,
      summary: "School Drop-off",
      location: "Elementary",
      start_iso: "2026-10-06T07:45:00-04:00",
      end_iso: "2026-10-06T08:15:00-04:00",
      all_day: false,
      html_link: "https://calendar.google.com/calendar/event?eid=anonymized",
    });
    const bravo = writes.eventCreates.find((r: any) => r.google_id === "evt_bravo");
    expect(bravo).toMatchObject({
      calendar_id: PRIMARY,
      start_iso: "2026-10-07",
      end_iso: "2026-10-08",
      all_day: true,
    });
  });

  it("full-pulls the explicit window every run and leaves a persisted sync_token untouched", async () => {
    const { pb, writes, calRows } = pbMock({
      calRows: [{ id: "cp", calendar_id: PRIMARY, summary: "Primary", selected: true, sync_token: "STALE" }],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue(envelope({ items: [] }));

    await syncCalendar();

    const [, args] = mocks.execute.mock.calls[0];
    expect(args.syncToken).toBeUndefined();
    expect(args.page_token).toBeUndefined();
    expect(args.time_min).toBeTruthy();
    expect(args.time_max).toBeTruthy();

    const saved = writes.calUpdates.find((u: any) => u.payload.last_status === "ok");
    expect(saved).toBeTruthy();
    expect("sync_token" in saved.payload).toBe(false);
    expect(calRows[0].sync_token).toBe("STALE");
  });

  it("isolates a per-calendar Composio api_error and records last_status:error", async () => {
    const { pb, writes } = pbMock({
      calRows: [
        { id: "cp", calendar_id: PRIMARY, summary: "Primary", selected: true, sync_token: null },
        { id: "cf", calendar_id: FAMILY, summary: "Family", selected: true, sync_token: null },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockImplementation(async (_action: string, args: any) => {
      if (args.calendar_id === FAMILY) throw composioApiError(503);
      return envelope({ items: [event("p1", "Primary thing")] });
    });

    const outcome = (await syncCalendar()) as any;

    expect(outcome.perCalendar).toHaveLength(2);
    const fam = outcome.perCalendar.find((c: any) => c.calendarId === FAMILY);
    const prim = outcome.perCalendar.find((c: any) => c.calendarId === PRIMARY);
    expect(prim.ok).toBe(true);
    expect(prim.events).toBe(1);
    expect(fam.ok).toBe(false);
    expect(fam.error).toContain("503");
    expect(outcome.events).toBe(1);

    const famErr = writes.calUpdates.find(
      (u: any) => u.id === "cf" && u.payload.last_status === "error",
    );
    expect(famErr.payload.last_error).toContain("503");
  });

  it("maps Composio auth_failed to a run-level GoogleAuthError, not a per-calendar record", async () => {
    const { pb, writes } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockRejectedValue(composioAuthError(401));

    let caught: unknown;
    try {
      await syncCalendar();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GoogleAuthError);
    expect((caught as GoogleAuthError).code).toBe("config");
    expect(writes.calUpdates.find((u: any) => u.payload.last_status === "error")).toBeUndefined();
  });

  it("throws no_grant without any Composio call when no account id is stored", async () => {
    const { pb } = pbMock({ connectedAccountId: null });
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await expect(syncCalendar()).rejects.toMatchObject({ code: "no_grant" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("listCalendars — Composio LIST_CALENDARS", () => {
  it("maps the envelope to the unchanged CalendarListEntry[] shape", async () => {
    const { pb } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValueOnce(fixture.executeListCalendars);

    const calendars = await listCalendars();

    const [action, , accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_LIST_CALENDARS");
    expect(accountId).toBe(ACCOUNT);
    expect(calendars).toEqual([
      { id: "primary", summary: "Family", primary: true, accessRole: "owner", colorRgb: "#039be5" },
      {
        id: "school@group.calendar.google.com",
        summary: "School",
        primary: false,
        accessRole: "reader",
        colorRgb: "#616161",
      },
    ]);
  });
});

describe("Composio write helpers", () => {
  it("createCalendarEvent calls CREATE_EVENT with connected_account_id and duration fields", async () => {
    const { pb } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue(
      envelope({
        response_data: {
          id: "evt_new",
          htmlLink: "https://calendar.google.com/calendar/event?eid=new",
          summary: "Dentist",
          start: { dateTime: "2026-10-06T10:00:00Z" },
          end: { dateTime: "2026-10-06T11:00:00Z" },
        },
      }),
    );

    const created = await createCalendarEvent({
      summary: "Dentist",
      description: "Checkup",
      location: "Clinic",
      start: { dateTime: "2026-10-06T10:00:00Z", timeZone: "America/Detroit" },
      end: { dateTime: "2026-10-06T11:00:00Z" },
    });

    const [action, args, accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_CREATE_EVENT");
    expect(accountId).toBe(ACCOUNT);
    expect(args).toMatchObject({
      calendar_id: PRIMARY,
      summary: "Dentist",
      description: "Checkup",
      location: "Clinic",
      start_datetime: "2026-10-06T10:00:00Z",
      timezone: "America/Detroit",
      event_duration_hour: 1,
      event_duration_minutes: 0,
    });
    expect(created.id).toBe("evt_new");
  });

  it("updateCalendarEvent calls PATCH_EVENT with event_id", async () => {
    const { pb } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue(
      envelope({ response_data: { id: "evt_1", summary: "Moved" } }),
    );

    const updated = await updateCalendarEvent(
      "evt_1",
      {
        summary: "Moved",
        start: { dateTime: "2026-10-06T12:00:00Z" },
        end: { dateTime: "2026-10-06T13:30:00Z" },
      },
      '"etag-1"',
    );

    const [action, args, accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_PATCH_EVENT");
    expect(accountId).toBe(ACCOUNT);
    expect(args).toMatchObject({
      calendar_id: PRIMARY,
      event_id: "evt_1",
      summary: "Moved",
      start_datetime: "2026-10-06T12:00:00Z",
      end_datetime: "2026-10-06T13:30:00Z",
    });
    expect(updated.id).toBe("evt_1");
  });

  it("deleteCalendarEvent calls DELETE_EVENT with event_id", async () => {
    const { pb } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue(envelope({}));

    await deleteCalendarEvent("evt_9");

    const [action, args, accountId] = mocks.execute.mock.calls[0];
    expect(action).toBe("GOOGLECALENDAR_DELETE_EVENT");
    expect(accountId).toBe(ACCOUNT);
    expect(args).toMatchObject({ calendar_id: PRIMARY, event_id: "evt_9" });
  });

  it("rejects a tool-level unsuccessful envelope instead of returning undefined", async () => {
    const { pb } = pbMock();
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
    mocks.execute.mockResolvedValue({
      data: null,
      successful: false,
      error: { message: "tool execution failed", code: "TOOL_EXECUTION_ERROR" },
    });

    await expect(createCalendarEvent({ summary: "X", start: { dateTime: "2026-10-06T10:00:00Z" }, end: { dateTime: "2026-10-06T11:00:00Z" } }))
      .rejects.toThrow("tool execution failed");
  });
});

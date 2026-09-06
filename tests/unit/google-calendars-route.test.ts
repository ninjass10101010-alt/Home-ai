import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isGoogleConnected: vi.fn(),
  listCalendars: vi.fn(),
  readCalendarSyncRows: vi.fn(),
  setCalendarSelection: vi.fn(),
  pruneCalendar: vi.fn(),
  ensureGoogleCollections: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/google/oauth-client", () => ({
  isGoogleConnected: mocks.isGoogleConnected,
}));

vi.mock("@/lib/google/calendar", () => ({
  listCalendars: mocks.listCalendars,
  readCalendarSyncRows: mocks.readCalendarSyncRows,
  setCalendarSelection: mocks.setCalendarSelection,
  pruneCalendar: mocks.pruneCalendar,
}));

vi.mock("@/lib/google/pb-collections", () => ({
  ensureGoogleCollections: mocks.ensureGoogleCollections,
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: vi.fn(async () => null),
}));

import { GET, PUT } from "@/app/api/google/calendars/route";

const FAMILY = "family@gmail.com";

function req(init?: { method?: string; body?: unknown; cookie?: string | null }): NextRequest {
  return new NextRequest("http://localhost/api/google/calendars", {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init?.cookie ? { cookie: `consuela_session=${init.cookie}` } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const GOOGLE_CALS = [
  { id: "primary", summary: "Jeffery Garcia", primary: true, accessRole: "owner", colorRgb: "#0b804b" },
  { id: FAMILY, summary: "Family", primary: false, accessRole: "owner", colorRgb: "#ab47bc" },
];

const SAVED_ROWS = [
  {
    id: "c1",
    calendar_id: "primary",
    summary: "Jeffery Garcia",
    color_rgb: "#0b804b",
    selected: true,
    sync_token: "TOK",
    last_sync_at: "2026-09-04 12:00:00.000Z",
    last_status: "ok",
    last_error: null,
  },
];

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.ensureGoogleCollections.mockResolvedValue([]);
});

describe("GET /api/google/calendars", () => {
  it("merges the Google calendarList with the saved selection state", async () => {
    mocks.isGoogleConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(GOOGLE_CALS);
    mocks.readCalendarSyncRows.mockResolvedValue(SAVED_ROWS);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.connected).toBe(true);
    expect(data.calendars).toEqual([
      {
        id: "primary",
        summary: "Jeffery Garcia",
        colorRgb: "#0b804b",
        selected: true,
        lastSyncAt: "2026-09-04 12:00:00.000Z",
        lastStatus: "ok",
      },
      {
        id: FAMILY,
        summary: "Family",
        colorRgb: "#ab47bc",
        selected: false, // never opted in, not primary → default OFF
        lastSyncAt: null,
        lastStatus: null,
      },
    ]);
  });

  it("defaults a calendar with no saved row to selected only when it is primary", async () => {
    mocks.isGoogleConnected.mockResolvedValue(true);
    mocks.listCalendars.mockResolvedValue(GOOGLE_CALS);
    mocks.readCalendarSyncRows.mockResolvedValue([]);

    const data = await (await GET()).json();
    expect(data.calendars.find((c: any) => c.id === "primary").selected).toBe(true);
    expect(data.calendars.find((c: any) => c.id === FAMILY).selected).toBe(false);
  });

  it("without a Google grant, serves the saved rows and never calls the API", async () => {
    mocks.isGoogleConnected.mockResolvedValue(false);
    mocks.readCalendarSyncRows.mockResolvedValue(SAVED_ROWS);

    const data = await (await GET()).json();

    expect(mocks.listCalendars).not.toHaveBeenCalled();
    expect(data.connected).toBe(false);
    expect(data.calendars).toHaveLength(1);
    expect(data.calendars[0]).toMatchObject({ id: "primary", selected: true });
  });
});

describe("PUT /api/google/calendars", () => {
  it("rejects an unauthenticated request (401) before touching anything", async () => {
    mocks.verifySession.mockResolvedValue(null);
    const res = await PUT(req({ method: "PUT", body: { calendars: [{ id: FAMILY, selected: true }] } }));
    expect(res.status).toBe(401);
    expect(mocks.setCalendarSelection).not.toHaveBeenCalled();
  });

  it("rejects a child session with 403 adult_only", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m1", name: "Caspian", role: "child" });
    const res = await PUT(
      req({ method: "PUT", cookie: "kid-cookie", body: { calendars: [{ id: FAMILY, selected: true }] } }),
    );
    expect(res.status).toBe(403);
    expect(mocks.setCalendarSelection).not.toHaveBeenCalled();
    expect(mocks.pruneCalendar).not.toHaveBeenCalled();
  });

  it("saves a newly selected calendar (no prior row → no token → next sync full-pulls)", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m0", name: "Jeffery", role: "parent" });
    mocks.readCalendarSyncRows.mockResolvedValue(SAVED_ROWS);
    mocks.setCalendarSelection.mockResolvedValue({ wasSelected: false });

    const res = await PUT(
      req({
        method: "PUT",
        cookie: "adult-cookie",
        body: { calendars: [{ id: FAMILY, summary: "Family", colorRgb: "#ab47bc", selected: true }] },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.setCalendarSelection).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: FAMILY, selected: true }),
    );
    expect(mocks.pruneCalendar).not.toHaveBeenCalled();
  });

  it("prunes a deselected calendar (cached rows + token removed)", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m0", name: "Jeffery", role: "parent" });
    mocks.readCalendarSyncRows.mockResolvedValue([
      ...SAVED_ROWS,
      { ...SAVED_ROWS[0], id: "c2", calendar_id: FAMILY, selected: true },
    ]);
    mocks.setCalendarSelection.mockResolvedValue({ wasSelected: true });
    mocks.pruneCalendar.mockResolvedValue({ deleted: 12 });

    const res = await PUT(
      req({
        method: "PUT",
        cookie: "adult-cookie",
        body: { calendars: [{ id: FAMILY, summary: "Family", colorRgb: "#ab47bc", selected: false }] },
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.pruneCalendar).toHaveBeenCalledWith(FAMILY);
    expect(data.pruned).toEqual([FAMILY]);
  });

  it("rejects an empty/invalid body with 400", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "m0", name: "Jeffery", role: "parent" });
    const res = await PUT(req({ method: "PUT", cookie: "adult-cookie", body: { calendars: [] } }));
    expect(res.status).toBe(400);
  });
});

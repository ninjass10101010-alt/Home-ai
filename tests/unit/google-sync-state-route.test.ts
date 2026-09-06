import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  readCalendarSyncRows: vi.fn(),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/google/calendar", () => ({
  readCalendarSyncRows: mocks.readCalendarSyncRows,
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { GET } from "@/app/api/google/sync-state/route";

// The legacy resource-keyed table (pre-migration). Its calendar row is
// never updated once per-calendar sync exists — a stale timestamp.
const LEGACY_ROWS = [
  { resource: "calendar", last_sync_at: "2026-08-01 10:00:00.000Z" },
  { resource: "tasks", last_sync_at: "2026-08-02 10:00:00.000Z" },
];

function legacyPb() {
  return {
    collection: () => ({
      getFullList: async () => LEGACY_ROWS,
    }),
  };
}

beforeEach(() => {
  mocks.readCalendarSyncRows.mockReset();
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(legacyPb()));
});

describe("GET /api/google/sync-state — calendar_last_sync_at", () => {
  it("uses the newest SELECTED per-calendar timestamp", async () => {
    mocks.readCalendarSyncRows.mockResolvedValue([
      {
        calendar_id: "primary",
        summary: "P",
        selected: true,
        last_sync_at: "2026-09-04 12:00:00.000Z",
        last_status: "ok",
        last_error: null,
      },
      {
        calendar_id: "family@gmail.com",
        summary: "F",
        selected: false,
        last_sync_at: "2026-09-01 09:00:00.000Z",
        last_status: "pruned",
        last_error: null,
      },
    ]);

    const data = await (await GET()).json();
    expect(data.calendar_last_sync_at).toBe("2026-09-04 12:00:00.000Z");
  });

  it("does NOT fall back to the stale legacy row when rows exist but none are selected", async () => {
    mocks.readCalendarSyncRows.mockResolvedValue([
      {
        calendar_id: "primary",
        summary: "P",
        selected: false,
        last_sync_at: null,
        last_status: "pruned",
        last_error: null,
      },
    ]);

    const data = await (await GET()).json();
    expect(data.calendar_last_sync_at).toBeNull();
  });

  it("falls back to the legacy row only when NO per-calendar rows exist at all", async () => {
    mocks.readCalendarSyncRows.mockResolvedValue([]);

    const data = await (await GET()).json();
    expect(data.calendar_last_sync_at).toBe("2026-08-01 10:00:00.000Z");
    expect(data.tasks_last_sync_at).toBe("2026-08-02 10:00:00.000Z");
  });
});

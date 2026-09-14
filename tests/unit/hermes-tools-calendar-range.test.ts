import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const rows: Record<string, any[]> = {};
const listCalls: Array<{ collection: string; filter?: string }> = [];
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => { listCalls.push({ collection: name, filter: opts?.filter }); return rows[name] ?? []; },
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, d: any) => { writes.push({ op: "update", collection: name, id, data: d }); return { id, ...d }; },
      create: async (d: any) => { writes.push({ op: "create", collection: name, data: d }); return { id: "n1", ...d }; },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));
import { getTool } from "@/lib/hermes-tools";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  listCalls.length = 0;
  writes.length = 0;
  vi.useFakeTimers({ now: new Date("2026-09-10T12:00:00") });
});
afterEach(() => vi.useRealTimers());

describe("get_calendar_range", () => {
  it("rejects malformed dates", async () => {
    const out = JSON.parse(await getTool("get_calendar_range")!.handler({ start: "tomorrow", end: "2026-09-12" }));
    expect(out.error).toBeTruthy();
  });
  it("merges family + google per day with one read each", async () => {
    rows.events = [{ id: "e1", title: "Dentist", date: "2026-09-12", time: "15:00", member: "Aurora" }];
    rows.consuela_google_calendar_events = [{ summary: "Field Trip", start_iso: "2026-09-11T09:00:00-04:00" }];
    rows.members = [{ name: "Aurora", fullName: "Aurora", emoji: "🧚" }];
    const out = JSON.parse(await getTool("get_calendar_range")!.handler({ start: "2026-09-11", end: "2026-09-12" }));
    expect(out.days["2026-09-11"][0].title).toBe("Field Trip");
    expect(out.days["2026-09-12"][0].title).toBe("Dentist");
    expect(listCalls.filter((c) => c.collection === "events")).toHaveLength(1);
    expect(listCalls.filter((c) => c.collection === "consuela_google_calendar_events")).toHaveLength(1);
  });
  it("caps the window at 30 days", async () => {
    const out = JSON.parse(await getTool("get_calendar_range")!.handler({ start: "2026-09-10", end: "2026-12-31" }));
    expect(out.error).toContain("30");
  });
});

describe("check_conflicts — family events included", () => {
  it("flags an overlap with a family event, not just Google rows", async () => {
    rows.events = [{ id: "e1", title: "Piano", date: "2026-09-11", time: "16:00", member: "Bailey" }];
    rows.consuela_google_calendar_events = [];
    const out = JSON.parse(await getTool("check_conflicts")!.handler({
      summary: "Soccer", start: "2026-09-11T15:30:00", end: "2026-09-11T16:30:00",
    }));
    expect(out.hasConflict).toBe(true);
  });
});

describe("update_event", () => {
  it("moves an event by title to a new date/time and echoes before/after", async () => {
    rows.events = [{ id: "e1", title: "Recital", date: "2026-09-10", time: "18:00", member: "Emily" }];
    const out = JSON.parse(await getTool("update_event")!.handler({ title: "Recital", date: "2026-09-11", time: "19:00" }));
    expect(out.ok).toBe(true);
    expect(out.before.date).toBe("2026-09-10");
    const w = writes.find((x) => x.op === "update" && x.collection === "events");
    expect(w!.data).toMatchObject({ date: "2026-09-11", time: "19:00" });
  });
  it("refuses ambiguous matches (same title, two dates, no date given)", async () => {
    rows.events = [
      { id: "e1", title: "Dentist", date: "2026-09-10", time: "09:00" },
      { id: "e2", title: "Dentist", date: "2026-09-20", time: "09:00" },
    ];
    const out = JSON.parse(await getTool("update_event")!.handler({ title: "Dentist", date: "2026-09-30" }));
    expect(out.ok).toBe(false);
    expect(out.error).toContain("date");
  });
});

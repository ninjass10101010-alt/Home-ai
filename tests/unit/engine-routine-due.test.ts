import { describe, it, expect, vi } from "vitest";
process.env.TZ = "America/Detroit";

let currentPb: unknown = null;
vi.mock("@/lib/pb-auth", () => ({ withAdmin: async (fn: (pb: unknown) => Promise<unknown>) => fn(currentPb) }));
vi.mock("@/db", () => ({ db: { insertProactiveSuggestions: vi.fn(async () => ({ inserted: 0, rejected: 0 })) } }));

import { scanRoutinesDue } from "@/lib/consuela/engine";

// Jan 7 2026 is a Wednesday. now = 08:00.
const now = new Date(2026, 0, 7, 8, 0, 0);
const WEEKDAY_NO = "mon,tue,thu,fri"; // excludes wed

function pbWithSchedules(rows: unknown[]) {
  currentPb = { collection: () => ({ getFullList: async () => rows }) };
}

it("emits a routine_due suggestion for a routine starting in 20 min", async () => {
  pbWithSchedules([{ id: "s1", title: "School pickup", time: "8:20 AM", days: "all" }]);
  const out = await scanRoutinesDue("2026-01-07", now);
  expect(out).toHaveLength(1);
  expect(out[0].kind).toBe("routine_due");
  expect(out[0].title).toMatch(/School pickup/);
  expect(out[0].title).toMatch(/8:20 AM/);
  expect(out[0].expiresAt).toBeTruthy();
  expect(out[0].scopeDate).toBe("2026-01-07");
});

it("ignores routines outside the 30-min window or not covering today", async () => {
  pbWithSchedules([
    { id: "s2", title: "Far", time: "12:00 PM", days: "all" }, // 4h out
    { id: "s3", title: "Not today", time: "8:10 AM", days: WEEKDAY_NO }, // 10min out, wrong day
    { id: "s4", title: "Already past", time: "7:00 AM", days: "all" }, // before now
  ]);
  const out = await scanRoutinesDue("2026-01-07", now);
  expect(out).toHaveLength(0);
});

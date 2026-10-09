// B1a D3 — the PB projection round-trips `awardedPoints`.
//
// The trap this pins (taskProjectionMatches:930): PocketBase coerces an unset
// number to 0 and a JSON row read back may simply lack the key. If the matcher
// treats a null/absent canonical value as a mismatch, `projectCanonicalTaskToPB`
// rewrites on every pass and then returns false — which is a projection
// failure, which is a `reconciled:false` 202, which is D4 firing in production.
import { describe, it, expect } from "vitest";

import {
  projectCanonicalTaskToPB,
  taskProjectionRecord,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";

const TAP = "2026-10-08T15:00:00.000Z";
const MONDAY = "2026-10-05";

function task(awardedPoints: number | null): SnapshotTask {
  return {
    id: 101,
    title: "Dishes",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    status: "done",
    due: null,
    points: 5,
    recurring: null,
    category: "Chores",
    priority: "medium",
    universal: false,
    stealable: false,
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: TAP,
    completedInWeek: MONDAY,
    pendingApproval: null,
    sentBackAt: null,
    awardedPoints,
    crewSize: null,
    crew: null,
    speedBonus: null,
    crewCloseMode: null,
    expiresAfterDays: null,
  } as unknown as SnapshotTask;
}

function fakeTasksPb(row: Record<string, unknown>) {
  const rows: any[] = [{ id: "r1", ...row }];
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    pb: {
      collection: () => ({
        getFullList: async () => rows.map((candidate) => ({ ...candidate })),
        update: async (id: string, payload: Record<string, unknown>) => {
          updates.push(payload);
          Object.assign(rows[0], payload);
          return { id, ...payload };
        },
        create: async (payload: Record<string, unknown>) => {
          rows.push(payload);
          return payload;
        },
        delete: async () => true,
      }),
    } as any,
  };
}

function mirrorRow(awardedPoints: number | null | undefined) {
  const record = { ...taskProjectionRecord(task(null)) };
  if (awardedPoints === undefined) delete (record as any).awardedPoints;
  else record.awardedPoints = awardedPoints;
  return record;
}

describe("the PB projection round-trips awardedPoints without a perpetual mismatch", () => {
  it("matches when the stored row simply lacks the key", async () => {
    const harness = fakeTasksPb(mirrorRow(undefined));
    await expect(projectCanonicalTaskToPB(harness.pb, task(null), 101)).resolves.toBe(true);
    expect(harness.updates).toHaveLength(0);
  });

  it("matches when PocketBase coerced the unset number to 0", async () => {
    const harness = fakeTasksPb(mirrorRow(0));
    await expect(projectCanonicalTaskToPB(harness.pb, task(null), 101)).resolves.toBe(true);
    expect(harness.updates).toHaveLength(0);
  });

  it("carries a real award through and matches it", async () => {
    const record = taskProjectionRecord(task(7));
    expect(record.awardedPoints).toBe(7);
    const harness = fakeTasksPb({ ...record });
    await expect(projectCanonicalTaskToPB(harness.pb, task(7), 101)).resolves.toBe(true);
    expect(harness.updates).toHaveLength(0);
  });
});

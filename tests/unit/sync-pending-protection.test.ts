// NOTE (2026-09-28): `protectPendingOnPush` is RETAINED FOR REFERENCE and
// currently has NO CALLER in `src/` — `grep -rn "protectPendingOnPush" src/`
// returns only its own declaration in `snapshot-tasks.ts:195`. The 8 cases below
// therefore pin the helper's merge logic, but NOT a live production path: they
// prove nothing that runs in the app today. Kept deliberately rather than
// deleted, because removal is a judgement call for the human: either wire the
// proof-gated push back in, or drop the helper and this suite together. If you
// wire a caller in, this header is wrong and must be removed.
import { describe, expect, it } from "vitest";
import { protectPendingOnPush, type SnapshotTask } from "@/lib/snapshot-tasks";

const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-23T15:00:00.000Z";
const T2 = "2026-09-23T16:00:00.000Z";

function pendingRow(overrides: Record<string, unknown> = {}): SnapshotTask {
  return {
    id: 42,
    title: "Dishes",
    points: 10,
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: T1,
    completedInWeek: "2026-09-21",
    pendingApproval: { byName: "Caspian Garcia", at: T1, points: 10 },
    sentBackAt: null,
    ...overrides,
  };
}

function apply(
  stored: SnapshotTask[],
  pushed: SnapshotTask[],
  pushedHistory: any[] = [],
  storedHistory: any[] = [],
) {
  return protectPendingOnPush({ storedTasks: stored, pushedTasks: pushed, pushedHistory, storedHistory });
}

describe("protectPendingOnPush migration helper", () => {
  it("preserves a live stored pending while accepting unrelated edits", () => {
    const [row] = apply(
      [pendingRow()],
      [{ id: 42, title: "Dishes v2", points: 12, completed: false }],
    );
    expect(row).toMatchObject({
      title: "Dishes v2",
      points: 12,
      completed: true,
      completedBy: "Caspian Garcia",
      completedAt: T1,
      pendingApproval: { byName: "Caspian Garcia", at: T1, points: 10 },
      sentBackAt: null,
    });
  });

  it("allows a pushed earn proof to clear pending", () => {
    const [row] = apply(
      [pendingRow()],
      [{ id: 42, title: "Dishes", completed: true, pendingApproval: null }],
      [{ id: 1, type: "earn", taskId: 42, member: "Caspian Garcia", amount: 10, timestamp: T2 }],
    );
    expect(row.pendingApproval).toBeNull();
  });

  it("requires send-back proof to post-date the pending tap", () => {
    const [stale] = apply(
      [pendingRow()],
      [{ id: 42, title: "Dishes", completed: false, sentBackAt: T0 }],
    );
    expect(stale.pendingApproval).toMatchObject({ at: T1 });

    const [fresh] = apply(
      [pendingRow()],
      [{ id: 42, title: "Dishes", completed: false, sentBackAt: T2 }],
    );
    expect(fresh.pendingApproval ?? null).toBeNull();
    expect(fresh.completed).toBe(false);
  });

  it("strips a pushed pending already resolved by stored payment", () => {
    const [row] = apply(
      [pendingRow({ pendingApproval: null })],
      [pendingRow()],
      [],
      [{ id: 1, type: "earn", taskId: 42, member: "Caspian Garcia", amount: 10, timestamp: T2 }],
    );
    expect(row.pendingApproval).toBeNull();
    expect(row.completed).toBe(true);
  });

  it("strips a pushed pending already resolved by stored send-back", () => {
    const [row] = apply(
      [pendingRow({ completed: false, completedBy: null, completedAt: null, pendingApproval: null, sentBackAt: T2 })],
      [pendingRow()],
    );
    expect(row.pendingApproval).toBeNull();
    expect(row.completed).toBe(false);
    expect(row.sentBackAt).toBe(T2);
  });

  it("accepts a genuinely fresh pending the server lacks", () => {
    const [row] = apply(
      [{ id: 42, title: "Dishes", points: 10, completed: false }],
      [pendingRow()],
    );
    expect(row.completed).toBe(true);
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", at: T1 });
  });

  it("keeps the newest pending claim", () => {
    const [olderStored] = apply(
      [pendingRow({ pendingApproval: { byName: "Caspian Garcia", at: T2, points: 10 } })],
      [pendingRow()],
    );
    expect(olderStored.pendingApproval).toMatchObject({ at: T2 });

    const [newerPushed] = apply(
      [pendingRow()],
      [pendingRow({ pendingApproval: { byName: "Caspian Garcia", at: T2, points: 10 } })],
    );
    expect(newerPushed.pendingApproval).toMatchObject({ at: T2 });
  });

  it("passes ordinary rows through verbatim", () => {
    const pushed = { id: 7, title: "New", points: 6, completed: true, completedBy: "Alex" };
    expect(apply([{ id: 7, title: "Old", points: 5, completed: false }], [pushed])).toEqual([pushed]);
  });
});

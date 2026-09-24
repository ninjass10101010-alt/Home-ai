// 2026-09-23 review — POST /api/tasks/sync replaced the snapshot's tasks leg
// VERBATIM with the pusher's local list. Kid devices never push the snapshot,
// so a parent's stale local list (captured before a kid's claim landed) could
// silently erase the pendingApproval the claim route had just written: the
// kid's "on the way" row never reached the parent queue and the points were
// never paid, with no self-heal. The route now runs every pushed row through
// protectPendingOnPush — proof gates mirroring the pull-side merge gates in
// mergeTasksSnapshot — so a push may only clear a stored live pending with
// proof (an earn tx in the PUSHER's history, or a send-back stamp that does
// not pre-date the tap), and may not resurrect a pending the stored row has
// already resolved (paid in the STORED history, or sent back after the tap).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));

import { POST } from "@/app/api/tasks/sync/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

type Row = { id: string; data: any };

const T0 = "2026-09-20T10:00:00.000Z";
const T1 = "2026-09-23T15:00:00.000Z";
const T2 = "2026-09-23T16:00:00.000Z";

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "Dishes",
    points: 10,
    assignee: "Caspian Garcia",
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: T1,
    completedInWeek: "2026-09-21",
    pendingApproval: { byName: "Caspian Garcia", at: T1, points: 10 },
    sentBackAt: null,
    ...over,
  };
}

function baseData(tasks: any[], history: any[] = []) {
  return {
    tasks,
    weekData: { weekStart: "2026-09-21", points: {}, history },
    rewards: [],
    penalties: [],
  };
}

/** Immediate (non-phased) in-memory PB mirroring the race-test's live store. */
function makeLive(data: any) {
  const live: Row = { id: "row1", data: JSON.parse(JSON.stringify(data)) };
  const pb = {
    collection: () => ({
      getFullList: async () => [{ ...live }],
      update: async (_id: string, payload: any) => {
        Object.assign(live, payload);
        return { ...live };
      },
      create: async (payload: any) => {
        Object.assign(live, { id: "new" }, payload);
        return { ...live };
      },
    }),
  };
  return { live, pb, snapshot: () => JSON.parse(JSON.stringify(live.data)) };
}

async function post(body: unknown, role: string) {
  const token = await signSession({ memberId: "m1", name: "Poster", role });
  const r = new NextRequest("http://x/api/tasks/sync", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
  });
  return POST(r);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  mocks.withAdmin.mockReset();
  __resetKeyedLockForTests();
});

describe("tasks/sync push-side pendingApproval protection", () => {
  it("a stale parent push NEVER erases a live stored pendingApproval (the kid-claim clobber)", async () => {
    const { pb, snapshot } = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    // The parent's device list predates the kid's tap entirely — but carries
    // a legitimate title edit that must still land.
    const res = await post(
      {
        tasks: [{ id: 42, title: "Dishes v2", points: 12, completed: false }],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);

    const row = snapshot().tasks.find((t: any) => t.id === 42);
    // The push's own fields land…
    expect(row.title).toBe("Dishes v2");
    expect(row.points).toBe(12);
    // …but the live tap survives with its completion stamps.
    expect(row.completed).toBe(true);
    expect(row.completedBy).toBe("Caspian Garcia");
    expect(row.completedAt).toBe(T1);
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", at: T1, points: 10 });
    expect(row.sentBackAt).toBeNull();
  });

  it("a parent push carrying the earn tx (approved on that device) MAY clear the pending", async () => {
    const { pb, snapshot } = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [{ id: 42, title: "Dishes", completed: true, completedBy: "Caspian Garcia", pendingApproval: null }],
        weekData: {
          weekStart: "2026-09-21",
          points: { "Caspian Garcia": 10 },
          history: [{ id: 1, type: "earn", taskId: 42, member: "Caspian Garcia", amount: 10, timestamp: T2 }],
        },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toBeNull();
  });

  it("a parent push with a send-back stamp post-dating the tap MAY clear + reopen the row", async () => {
    const { pb, snapshot } = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [{ id: 42, title: "Dishes", completed: false, sentBackAt: T2 }],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    // Verbatim accept: the row adopts the pusher's shape (no pendingApproval
    // key at all — client readers treat absent and null identically).
    expect(row.pendingApproval ?? null).toBeNull();
    expect(row.completed).toBe(false);
    expect(row.sentBackAt).toBe(T2);
  });

  it("a STALE send-back stamp (pre-dating the tap) does NOT clear a fresh pending", async () => {
    // Send-back → kid re-claimed (fresh pending at T1); a device still holding
    // the pre-re-claim stamp (T0) pushes it — the stamp is stale proof.
    const { pb, snapshot } = makeLive(baseData([pendingRow({ sentBackAt: null })]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [{ id: 42, title: "Dishes", completed: false, sentBackAt: T0 }],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toMatchObject({ at: T1 });
  });

  it("a stale device CANNOT resurrect a pending the stored row already paid (ghost strip)", async () => {
    const { pb, snapshot } = makeLive(
      baseData(
        [pendingRow({ pendingApproval: null, completedBy: "Caspian Garcia" })],
        [{ id: 1, type: "earn", taskId: 42, member: "Caspian Garcia", amount: 10, timestamp: T2 }]
      )
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    // Device B never saw the approval — pushes its old pending copy.
    const res = await post(
      {
        tasks: [pendingRow()],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toBeNull();
    expect(row.completed).toBe(true); // paid state preserved
  });

  it("a stale device CANNOT resurrect a pending the stored row already sent back", async () => {
    const { pb, snapshot } = makeLive(
      baseData([pendingRow({ completed: false, completedBy: null, completedAt: null, pendingApproval: null, sentBackAt: T2 })])
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [pendingRow()], // stale copy: completed + pending from before the send-back
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toBeNull();
    expect(row.completed).toBe(false); // reopen preserved
    expect(row.sentBackAt).toBe(T2);
  });

  it("a genuinely FRESH pending the server lacks is ACCEPTED (fire-and-forget loss self-heal)", async () => {
    const { pb, snapshot } = makeLive(
      baseData([{ id: 42, title: "Dishes", points: 10, completed: false }])
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [pendingRow()],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toMatchObject({ byName: "Caspian Garcia", at: T1 });
    expect(row.completed).toBe(true);
  });

  it("both sides pend — the NEWEST claim wins", async () => {
    const stored = pendingRow({ pendingApproval: { byName: "Caspian Garcia", at: T2, points: 10 } });
    const { pb, snapshot } = makeLive(baseData([stored]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    // Pushed claim is OLDER (a device holding the first tap after a re-claim).
    const res = await post(
      {
        tasks: [pendingRow()], // at T1 — older than the stored T2
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toMatchObject({ at: T2 });

    // …and the reverse: a pushed claim NEWER than stored replaces it.
    const live2 = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(live2.pb));
    const res2 = await post(
      {
        tasks: [pendingRow({ pendingApproval: { byName: "Caspian Garcia", at: T2, points: 10 } })],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res2.status).toBe(200);
    const row2 = live2.snapshot().tasks.find((t: any) => t.id === 42);
    expect(row2.pendingApproval).toMatchObject({ at: T2 });
  });

  it("a KID push can never clear a stored pending — weekData poison legs earn no proof", async () => {
    const { pb, snapshot } = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [{ id: 42, title: "Dishes", completed: false }],
        // Poison: a kid body carrying an earn tx must earn nothing — the
        // route ignores non-parent weekData legs, including for proofs.
        weekData: {
          weekStart: "2026-09-21",
          points: {},
          history: [{ id: 1, type: "earn", taskId: 42, member: "Caspian Garcia", amount: 10, timestamp: T2 }],
        },
      },
      "child"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignoredLegs).toContain("weekData");
    const row = snapshot().tasks.find((t: any) => t.id === 42);
    expect(row.pendingApproval).toMatchObject({ at: T1 });
    expect(row.completed).toBe(true);
  });

  it("no pendings anywhere → the common path stays verbatim (no protection overhead)", async () => {
    const { pb, snapshot } = makeLive(
      baseData([{ id: 7, title: "Old", points: 5, completed: false }])
    );
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [{ id: 7, title: "New", points: 6, completed: true, completedBy: "Alex" }],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const row = snapshot().tasks.find((t: any) => t.id === 7);
    expect(row).toMatchObject({ title: "New", points: 6, completed: true, completedBy: "Alex" });
  });

  it("a tombstoned row wins over protection — deleting a pending task still deletes it", async () => {
    const { pb, snapshot } = makeLive(baseData([pendingRow()]));
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const res = await post(
      {
        tasks: [],
        deletedTaskIds: [42],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      },
      "parent"
    );
    expect(res.status).toBe(200);
    const stored = snapshot();
    expect(stored.tasks.find((t: any) => t.id === 42)).toBeUndefined();
    expect(stored.deletedTaskIds).toContain(42);
  });
});

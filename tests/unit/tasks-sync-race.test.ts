// Fix #8 — POST /api/tasks/sync's non-parent path re-reads the stored
// snapshot's parent-owned legs and writes them BACK. Between that read and
// the write a parent's full-body sync can land — the non-parent's write then
// resurrects the OLD parent legs, silently reverting the parent's just-pushed
// points/rewards on the shared snapshot. The whole read-modify-write must be
// serialized (keyed lock) so a non-parent leg-merge always re-reads fresh.
//
// The interleaving is orchestrated with phase-tagged deferreds (the
// week-ledger-lock test idiom) so the dangerous order is forced
// deterministically: BOTH reads see the pre-parent state, the parent writes,
// the kid writes its stale merge LAST — the resurrection direction.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

type Deferred = { resolved: boolean; resolve: (v: unknown) => void; compute: () => unknown };

const h = vi.hoisted(() => {
  const live = {
    row: {
      id: "row1",
      data: {
        tasks: [{ id: "old", title: "Old chore" }],
        weekData: { weekStart: "2026-09-14", points: { Alex: 5 }, history: [] },
        rewards: [{ id: "good-reward" }],
        penalties: [],
        rewardsUpdatedAt: "old-stamp",
      },
    },
  };
  const phases = new Map<string, Deferred[]>();
  const call = (phase: string, compute: () => unknown) =>
    new Promise<unknown>((resolve) => {
      const d: Deferred = {
        resolved: false,
        resolve: (v: unknown) => {
          d.resolved = true;
          resolve(v);
        },
        compute,
      };
      const list = phases.get(phase) ?? [];
      list.push(d);
      phases.set(phase, list);
    });
  const resolveOne = (phase: string, idx: number): boolean => {
    const d = (phases.get(phase) ?? [])[idx];
    if (!d || d.resolved) return false;
    d.resolve(d.compute());
    return true;
  };
  const snapshot = () => JSON.parse(JSON.stringify(live.row.data));
  const pb = {
    collection: () => ({
      getFullList: () => call("read", () => [{ ...live.row }]),
      update: (_id: string, payload: any) =>
        call("write", () => {
          Object.assign(live.row, payload);
          return { ...live.row };
        }),
      create: (payload: any) =>
        call("write", () => {
          Object.assign(live.row, { id: "new" }, payload);
          return { ...live.row };
        }),
    }),
  };
  return { live, resolveOne, snapshot, pb };
});

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));

import { POST } from "@/app/api/tasks/sync/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

async function post(body: unknown, role: string) {
  const token = await signSession({ memberId: "m1", name: "Poster", role });
  const r = new NextRequest("http://x/api/tasks/sync", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
  });
  return POST(r);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Resolve parked pb calls one per iteration in preference order, skipping
 * entries that don't exist (yet), until both responses settle. */
async function drive(order: Array<[string, number]>, responses: Array<Promise<Response>>) {
  const settled = responses.map(() => false);
  responses.forEach((p, i) => p.then(() => { settled[i] = true; }, () => { settled[i] = true; }));
  let guard = 0;
  while (!settled.every(Boolean)) {
    if (guard++ > 200) throw new Error("drive() stalled");
    for (const [phase, idx] of order) {
      if (h.resolveOne(phase, idx)) break;
    }
    await tick();
  }
  return Promise.all(responses);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  h.live.row = {
    id: "row1",
    data: {
      tasks: [{ id: "old", title: "Old chore" }],
      weekData: { weekStart: "2026-09-14", points: { Alex: 5 }, history: [] },
      rewards: [{ id: "good-reward" }],
      penalties: [],
      rewardsUpdatedAt: "old-stamp",
    },
  };
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: any) => fn(h.pb));
  __resetKeyedLockForTests();
});

describe("tasks/sync read-modify-write atomicity", () => {
  it("a kid's tasks-leg sync interleaved with a parent's full write NEVER resurrects the parent's old legs", async () => {
    const parentBody = {
      tasks: [{ id: "p1", title: "Parent chore" }],
      weekData: { weekStart: "2026-09-14", points: { Caspian: 20 }, history: [] },
      rewards: [{ id: "new-reward" }],
      penalties: [],
      rewardsUpdatedAt: "new-stamp",
    };
    const kidBody = {
      tasks: [{ id: "k1", title: "Kid chore" }],
      // Poison legs a kid must never own — the merge must ignore them.
      weekData: { weekStart: "2026-09-14", points: { Alex: 999 }, history: [] },
    };

    // Parent first, kid second — with the lock the parent's section runs to
    // completion before the kid's read, which is the whole point.
    const [parentRes, kidRes] = await drive(
      [["read", 0], ["read", 1], ["write", 0], ["write", 1]],
      [post(parentBody, "parent"), post(kidBody, "child")]
    );
    expect(parentRes.status).toBe(200);
    expect(kidRes.status).toBe(200);

    const stored = h.snapshot();
    // The parent's fresh legs SURVIVE the interleaved kid write…
    expect(stored.weekData.points).toEqual({ Caspian: 20 });
    expect(stored.rewards).toEqual([{ id: "new-reward" }]);
    expect(stored.rewardsUpdatedAt).toBe("new-stamp");
    // …and the kid's tasks leg landed too (its poison legs ignored).
    expect(stored.tasks).toEqual([{ id: "k1", title: "Kid chore" }]);
  });
});

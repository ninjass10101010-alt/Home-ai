import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  verifySession: vi.fn(),
  requireLiveSession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: mocks.requireLiveSession,
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

import { POST as configPOST } from "@/app/api/tasks/config/route";
import { POST as syncPOST } from "@/app/api/tasks/sync/route";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeLive() {
  const live = {
    row: {
      id: "snapshot-1",
      data: {
        revision: "4",
        tasks: [{ id: 1, title: "Old" }],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
        rewards: [{ id: "old", name: "Old", emoji: "🗑️", cost: 1 }],
        rewardsUpdatedAt: "2026-09-24T09:00:00.000Z",
        penalties: [],
        penaltiesUpdatedAt: "2026-09-24T09:00:00.000Z",
        weeklyPrizes: [],
        weeklyPrizesStamp: "2026-09-24T09:00:00.000Z",
        operationReceipts: {
          canonical: [{
            operationId: "canonical",
            action: "approve",
            taskId: 1,
            createdAt: "2026-09-24T09:00:00.000Z",
          }],
        },
        configOperationReceipts: {},
        pendingProjectionRepairs: [],
      },
    },
    rewards: [] as any[],
    snapshotReads: 0,
    activeSnapshotReads: 0,
    maxActiveSnapshotReads: 0,
    park: deferred(),
    parkNext: true,
  };

  const pb = {
    collection: (name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: async () => {
            live.snapshotReads += 1;
            live.activeSnapshotReads += 1;
            live.maxActiveSnapshotReads = Math.max(
              live.maxActiveSnapshotReads,
              live.activeSnapshotReads,
            );
            if (live.parkNext) {
              live.parkNext = false;
              await live.park.promise;
            }
            const result = [{ ...live.row, data: structuredClone(live.row.data) }];
            live.activeSnapshotReads -= 1;
            return result;
          },
          update: async (_id: string, payload: any) => {
            live.row = { ...live.row, ...structuredClone(payload) };
            return live.row;
          },
          create: async (payload: any) => {
            live.row = { id: "snapshot-1", ...structuredClone(payload) };
            return live.row;
          },
        };
      }
      if (name === "rewards") {
        return {
          getFullList: async () => structuredClone(live.rewards),
          create: async (payload: any) => {
            const row = { id: `reward-${live.rewards.length + 1}`, ...payload };
            live.rewards.push(row);
            return row;
          },
          update: async () => null,
          delete: async () => true,
        };
      }
      return {
        getFullList: async () => [],
        create: async () => null,
        update: async () => null,
        delete: async () => true,
      };
    },
  };

  return { live, pb };
}

function request(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "consuela_session=parent-test-credential",
    },
    body: JSON.stringify(body),
  });
}

async function waitForReads(count: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (count === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("snapshot read was not reached");
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyLiveParentSession.mockReset();
  mocks.verifySession.mockReset();
  mocks.requireLiveSession.mockReset().mockResolvedValue({
    ok: true,
    identity: { memberId: "parent-live", name: "Live Parent", role: "parent" },
  });
  __resetKeyedLockForTests();
  mocks.verifyLiveParentSession.mockResolvedValue({
    ok: true,
    member: { id: "parent-live", name: "Live Parent", role: "parent" },
  });
  mocks.verifySession.mockResolvedValue({
    memberId: "parent-live",
    name: "Live Parent",
    role: "parent",
  });
});

describe("task config actual keyed-lock serialization", () => {
  it("rejects the retired legacy full sync while the config command still wins", async () => {
    const state = makeLive();
    mocks.withAdmin.mockImplementation((fn: any) => fn(state.pb));
    const t1 = new Date().toISOString();

    const configRequest = request("/api/tasks/config", {
      operationId: "serialized-config",
      kind: "rewards",
      action: "replace",
      updatedAt: t1,
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    });
    const configPromise = configPOST(configRequest);
    await waitForReads(1);

    const syncPromise = syncPOST(request("/api/tasks/sync", {
      tasks: [{ id: 2, title: "Concurrent" }],
      weekData: { weekStart: "2026-09-21", points: {}, history: [] },
      rewards: [{ id: "evil", name: "Evil", emoji: "🗑️", cost: 1 }],
      rewardsUpdatedAt: "9999-12-31T23:59:59.999Z",
      penalties: [{ id: "evil-penalty", name: "Evil", emoji: "⚠️", points: 99 }],
      penaltiesUpdatedAt: "9999-12-31T23:59:59.999Z",
      weeklyPrizes: [{ id: "evil-prize", rank: 1, emoji: "🥇", text: "Evil" }],
      weeklyPrizesStamp: "9999-12-31T23:59:59.999Z",
      revision: "999",
      operationReceipts: { evil: [] },
      configOperationReceipts: { evil: {} },
      pendingProjectionRepairs: [],
    }));

    state.live.park.resolve();
    const [configResponse, syncResponse] = await Promise.all([configPromise, syncPromise]);

    // The browser is no longer a writer: the retired full-sync POST is refused
    // with 410 and changes nothing, while the config command — serialized
    // against the same snapshot lock — lands exactly as asked.
    expect(configResponse.status).toBe(200);
    expect(syncResponse.status).toBe(410);
    expect(state.live.maxActiveSnapshotReads).toBe(1);
    expect(state.live.row.data.revision).toBe("5");
    expect(state.live.row.data.rewards).toEqual([
      { name: "Movie", emoji: "🎬", cost: 50 },
    ]);
    expect(state.live.row.data.rewardsUpdatedAt).toBe(t1);
    // The refused sync's "evil" legs never reached the snapshot.
    expect(state.live.row.data.tasks).toEqual([{ id: 1, title: "Old" }]);
    expect(state.live.row.data.penalties).toEqual([]);
    expect(state.live.row.data.weeklyPrizes).toEqual([]);
    expect(state.live.row.data.operationReceipts).toEqual({
      canonical: [{
        operationId: "canonical",
        action: "approve",
        taskId: 1,
        createdAt: "2026-09-24T09:00:00.000Z",
      }],
    });
  });

  it("serializes two same-kind config commands against a fresh snapshot", async () => {
    const state = makeLive();
    mocks.withAdmin.mockImplementation((fn: any) => fn(state.pb));
    const t1 = new Date().toISOString();
    const t2 = new Date(Date.parse(t1) + 1000).toISOString();

    const first = configPOST(request("/api/tasks/config", {
      operationId: "serialized-first",
      kind: "rewards",
      action: "replace",
      updatedAt: t1,
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    }));
    await waitForReads(1);
    const second = configPOST(request("/api/tasks/config", {
      operationId: "serialized-second",
      kind: "rewards",
      action: "upsert",
      updatedAt: t2,
      item: { id: 2, name: "Snacks", emoji: "🍿", cost: 15 },
    }));

    state.live.park.resolve();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(state.live.maxActiveSnapshotReads).toBe(1);
    expect(state.live.row.data.revision).toBe("6");
    expect(state.live.row.data.rewards).toEqual([
      { name: "Movie", emoji: "🎬", cost: 50 },
      { id: 2, name: "Snacks", emoji: "🍿", cost: 15 },
    ]);
  });
});

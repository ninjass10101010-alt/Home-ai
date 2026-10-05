// @vitest-environment node
// Snapshot-size cap guards (2026-10-05 incident): every member-assigned add
// failed with `validation_json_size_limit` because roster photo avatars
// (105-246KB base64 data URLs) were copied raw into the snapshot's
// tasks[].assigneeEmoji / crew[].emoji, pushing the single tasks-snapshot row
// past PocketBase's default 1 MiB json maxSize.
//
// These tests pin the four legs of the fix:
//   1. write-point slimming (TASK_MANAGE_MAX_EMOJI_LENGTH 400_000 -> 4_096)
//   2. cap headroom (consuela_data_snapshots.data maxSize -> 8 MiB via pb-seed)
//   3. observability (snapshot-write catches log status + clamped body)
//   4. live-data slimming (slimTaskEmojis + slim-on-read in the snapshot path)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const parentTestCredential = "parent-test-credential";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  getLiveMembers: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
  getLiveMembers: mocks.getLiveMembers,
}));

vi.mock("@/lib/keyed-lock", () => ({
  withKeyedLock: async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
  __resetKeyedLockForTests: vi.fn(),
}));

vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: async <T>(_week: string, fn: () => Promise<T>): Promise<T> => fn(),
  __resetWeekLedgerLockForTests: vi.fn(),
}));

import { slimTaskEmoji, slimTaskEmojis, TASK_SNAPSHOT_EMOJI_MAX } from "@/lib/task-emoji";
import {
  TASK_MANAGE_MAX_CREW_SIZE,
  TASK_MANAGE_MAX_EMOJI_LENGTH,
} from "@/lib/task-manage";
import { COLLECTIONS, SNAPSHOT_DATA_MAX_SIZE, seedCollections } from "@/lib/pb-seed";
import {
  describeSnapshotWriteError,
  mutateSnapshotWithMeta,
  SNAPSHOT_KEY,
} from "@/lib/snapshot-tasks";
import { reconcileTaskProjectionLocked } from "@/lib/task-projection-reconciler";

type Row = Record<string, any>;

// A roster photo the same size class as the live parents (~246 KB).
const FAT_PHOTO = `data:image/webp;base64,${"A".repeat(246_000)}`;

describe("slimTaskEmojis — live-data slimming primitive", () => {
  const fat = `data:image/webp;base64,${"C".repeat(250_000)}`;

  it("returns the SAME reference when nothing is fat (mergeTasksSnapshot no-change contract)", () => {
    const task = {
      id: 1,
      title: "Dishes",
      assigneeEmoji: "🦊",
      crew: { members: [{ name: "Bailey", emoji: "👧", joinedAt: "x" }] },
    };
    expect(slimTaskEmojis(task)).toBe(task);
  });

  it("slims a fat assigneeEmoji to the fallback glyph and keeps every other field", () => {
    const task = { id: 2, title: "Laundry", assigneeEmoji: fat, points: 5 };
    const out = slimTaskEmojis(task);

    expect(out).not.toBe(task);
    expect(out.assigneeEmoji).toBe("👤");
    expect(out.title).toBe("Laundry");
    expect(out.points).toBe(5);
    expect(out.id).toBe(2);
  });

  it("slims each fat crew[].emoji and leaves real glyph crew emojis untouched", () => {
    const task = {
      id: 3,
      title: "Garage",
      assigneeEmoji: "👤",
      crew: {
        members: [
          { name: "Emily", emoji: fat, joinedAt: "x" },
          { name: "Bailey", emoji: "🌸", joinedAt: "y" },
        ],
        removed: ["Rocco"],
      },
    };
    const out = slimTaskEmojis(task);

    expect(out.crew.members[0].emoji).toBe("👤");
    expect(out.crew.members[1].emoji).toBe("🌸");
    expect(out.crew.removed).toEqual(["Rocco"]);
    expect(out.assigneeEmoji).toBe("👤");
  });

  it("slimTaskEmoji collapses fat values, keeps glyphs, and maps empty to empty", () => {
    expect(slimTaskEmoji(fat)).toBe("👤");
    expect(slimTaskEmoji("🦊")).toBe("🦊");
    expect(slimTaskEmoji(undefined)).toBe("");
    expect(slimTaskEmoji(null)).toBe("");
  });
});

describe("snapshot size-cap coherence", () => {
  it("the emoji ceiling is 4_096 everywhere it is declared", () => {
    expect(TASK_MANAGE_MAX_EMOJI_LENGTH).toBe(4_096);
    expect(TASK_SNAPSHOT_EMOJI_MAX).toBe(4_096);
  });

  it("the per-task emoji budget stays far below the snapshot maxSize with a documented margin", () => {
    // Worst case per task: one assigneeEmoji plus one emoji per crew member
    // (crew size caps at TASK_MANAGE_MAX_CREW_SIZE) = 6 emoji-bearing fields.
    const worstCaseEmojiFieldsPerTask = 1 + TASK_MANAGE_MAX_CREW_SIZE;
    const worstCaseEmojiBytesPerTask =
      TASK_MANAGE_MAX_EMOJI_LENGTH * worstCaseEmojiFieldsPerTask;
    expect(worstCaseEmojiBytesPerTask).toBe(24_576);
    // Documented margin: even 100 worst-case tasks' entire emoji budget is a
    // rounding error against the 8 MiB field cap. Raising the emoji ceiling
    // past ~1.3 MB/task (or the cap below ~2.5 MB) must fail this assertion,
    // forcing the two constants to move together.
    expect(worstCaseEmojiBytesPerTask * 100).toBeLessThan(SNAPSHOT_DATA_MAX_SIZE);
    expect(SNAPSHOT_DATA_MAX_SIZE).toBe(8_388_608);
  });

  it("the live ~960KB blob, plus one worst-case roster photo, fits the raised cap", () => {
    expect(959_836).toBeLessThan(SNAPSHOT_DATA_MAX_SIZE);
    expect(959_836 + 245_972).toBeLessThan(SNAPSHOT_DATA_MAX_SIZE);
  });
});

describe("pb-seed consuela_data_snapshots.data maxSize", () => {
  const LOCKED = {
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };

  function snapshotsDef() {
    return COLLECTIONS.find((c) => c.name === "consuela_data_snapshots")!;
  }

  function liveFieldsFor(maxSize: number): any[] {
    const fields: any[] = snapshotsDef().schema.map((s: any) => {
      if (s.type === "json") return { name: s.name, type: "json", maxSize, required: !!s.required };
      return { name: s.name, type: s.type || "text", max: s.options?.max ?? 0, required: !!s.required };
    });
    fields.push({ name: "created" });
    fields.push({ name: "updated" });
    return fields;
  }

  function makePb(existing: any[] = []) {
    return {
      collections: {
        getFullList: vi.fn(async () => existing),
        create: vi.fn(async (payload: any) => ({ id: `new_${payload.name}`, ...payload })),
        update: vi.fn(async (id: string, body: any) => ({ id, ...body })),
      },
    };
  }

  beforeEach(() => {
    mocks.withAdmin.mockReset();
  });

  it("declares maxSize 8 MiB on the data json field", () => {
    const data = snapshotsDef().schema.find((s: any) => s.name === "data");
    expect(data).toBeDefined();
    expect(data!.type).toBe("json");
    expect((data as any).options?.maxSize).toBe(SNAPSHOT_DATA_MAX_SIZE);
  });

  it("heals a live collection whose data.maxSize is PB's 1 MiB default up to 8 MiB", async () => {
    const live = {
      id: "snap_live_1",
      name: "consuela_data_snapshots",
      fields: liveFieldsFor(1_048_576),
      indexes: snapshotsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const updateCall = (pb.collections.update as any).mock.calls.find(
      (c: any[]) => c[0] === "snap_live_1"
    );
    expect(updateCall).toBeDefined();
    const fields = updateCall[1].fields as any[];
    expect(fields.find((f: any) => f.name === "data").maxSize).toBe(SNAPSHOT_DATA_MAX_SIZE);
  });

  it("leaves an already-raised data.maxSize untouched (idempotent)", async () => {
    const live = {
      id: "snap_live_2",
      name: "consuela_data_snapshots",
      fields: liveFieldsFor(SNAPSHOT_DATA_MAX_SIZE),
      indexes: snapshotsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    expect((pb.collections.update as any).mock.calls.some(
      (c: any[]) => c[0] === "snap_live_2"
    )).toBe(false);
  });

  it("never lowers a data.maxSize that is already larger than the seed target", async () => {
    const live = {
      id: "snap_live_3",
      name: "consuela_data_snapshots",
      fields: liveFieldsFor(16_777_216),
      indexes: snapshotsDef().indexes || [],
      ...LOCKED,
    };
    const pb = makePb([live]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    expect((pb.collections.update as any).mock.calls.some(
      (c: any[]) => c[0] === "snap_live_3"
    )).toBe(false);
  });

  it("emits maxSize on the fresh-create path too", async () => {
    const pb = makePb([]);
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));

    await seedCollections();

    const createCall = (pb.collections.create as any).mock.calls.find(
      (c: any[]) => c[0].name === "consuela_data_snapshots"
    );
    expect(createCall).toBeDefined();
    const fields = createCall[0].fields as any[];
    const data = fields.find((f: any) => f.name === "data");
    expect(data.options?.maxSize ?? data.maxSize).toBe(SNAPSHOT_DATA_MAX_SIZE);
  });
});

function makeManageHarness(options?: {
  snapshot?: Row;
  taskRows?: Row[];
  failSnapshotWriteWith?: unknown;
}) {
  let snapshot = structuredClone(
    options?.snapshot ?? {
      revision: "4",
      tasks: [],
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    },
  );
  let taskRows = structuredClone(options?.taskRows ?? []);
  let failSnapshotWriteWith = options?.failSnapshotWriteWith;
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: vi.fn(async () => [
            { id: "snapshot-1", data: structuredClone(snapshot), updated_at: "2026-09-24T10:00:00.000Z" },
          ]),
          update: vi.fn(async (_id: string, payload: Row) => {
            if (failSnapshotWriteWith) {
              const err = failSnapshotWriteWith;
              failSnapshotWriteWith = undefined;
              throw err;
            }
            snapshot = structuredClone(payload.data);
            return { id: "snapshot-1", ...structuredClone(payload) };
          }),
          create: vi.fn(async (payload: Row) => {
            snapshot = structuredClone(payload.data);
            return { id: "snapshot-1", ...structuredClone(payload) };
          }),
        };
      }
      if (name === "tasks") {
        return {
          getFullList: vi.fn(async () => structuredClone(taskRows)),
          create: vi.fn(async (payload: Row) => {
            const row = { id: `pb-${taskRows.length + 1}`, ...structuredClone(payload) };
            taskRows.push(row);
            return structuredClone(row);
          }),
          update: vi.fn(async (id: string, payload: Row) => {
            const index = taskRows.findIndex((row) => row.id === id);
            if (index >= 0) taskRows[index] = { ...taskRows[index], ...structuredClone(payload) };
            return structuredClone(taskRows[index]);
          }),
          delete: vi.fn(async (id: string) => {
            taskRows = taskRows.filter((row) => row.id !== id);
            return true;
          }),
        };
      }
      if (name === "members") {
        return { getFullList: vi.fn(async () => []) };
      }
      throw new Error(`unexpected collection ${name}`);
    }),
  };
  return {
    pb,
    snapshot: () => structuredClone(snapshot),
    tasks: () => structuredClone(taskRows),
  };
}

async function postManage(harness: { pb: any }, body: unknown) {
  mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
  const { POST } = await import("@/app/api/tasks/manage/route");
  return POST(
    new NextRequest("http://localhost/api/tasks/manage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `consuela_session=${parentTestCredential}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/tasks/manage — worst-case photo-avatar payload", () => {
  beforeEach(() => {
    mocks.withAdmin.mockReset();
    mocks.verifyLiveParentSession.mockReset();
    mocks.getLiveMembers.mockReset();
    mocks.getLiveMembers.mockResolvedValue([
      { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
      { id: "child-1", name: "Alex Child", role: "child", emoji: FAT_PHOTO },
    ]);
    mocks.verifyLiveParentSession.mockImplementation(async () => ({
      ok: true as const,
      member: { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores 👤 for a ~246KB photo assignee and the task row stays far below 5KB", async () => {
    const harness = makeManageHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-fat-photo",
      task: { title: "Dog Walk", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(200);
    const added = harness.snapshot().tasks.find((row: Row) => row.title === "Dog Walk");
    expect(added).toBeTruthy();
    expect(added.assigneeEmoji).toBe("👤");
    expect(JSON.stringify(added).length).toBeLessThan(5_000);
    const pbRow = harness.tasks().find((row: Row) => row.title === "Dog Walk");
    expect(pbRow).toBeTruthy();
    expect(pbRow!.assigneeEmoji).toBe("👤");
  });

  it("a client-sent raw photo assigneeEmoji is accepted (canonicalized from the roster), not rejected", async () => {
    const harness = makeManageHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-client-photo-field",
      task: { title: "Feed Rex", assignee: "Alex Child", points: 1, assigneeEmoji: FAT_PHOTO },
    });

    expect(response.status).toBe(200);
    const added = harness.snapshot().tasks.find((row: Row) => row.title === "Feed Rex");
    expect(added.assigneeEmoji).toBe("👤");
  });
});

describe("snapshot-write failure observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describeSnapshotWriteError reports status + the PB size-limit message, clamped", () => {
    const error = {
      status: 400,
      data: {
        data: {
          code: "validation_json_size_limit",
          message: "The maximum allowed JSON size is 1048576 bytes.",
          params: { maxSize: 1048576 },
        },
        message: "Failed to update record.",
      },
    };
    const described = describeSnapshotWriteError(error);

    expect(described).toContain("status=400");
    expect(described).toContain("The maximum allowed JSON size is 1048576 bytes.");
    expect(described.length).toBeLessThan(400);
  });

  it("redacts data URLs and long base64 runs from the logged body", () => {
    const error = {
      status: 400,
      data: {
        message: `Failed to update record. data:image/webp;base64,${"B".repeat(300_000)}`,
      },
    };
    const described = describeSnapshotWriteError(error);

    expect(described).toContain("status=400");
    expect(described).not.toContain("B".repeat(300_000));
    expect(described).not.toContain("data:image/webp;base64,");
    expect(described.length).toBeLessThan(400);
  });

  it("the manage catch logs the PB error and still returns snapshot_write_failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.verifyLiveParentSession.mockImplementation(async () => ({
      ok: true as const,
      member: { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    }));
    mocks.getLiveMembers.mockResolvedValue([
      { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
      { id: "child-1", name: "Alex Child", role: "child", emoji: "🦊" },
    ]);
    const pbError = Object.assign(new Error("Failed to update record."), {
      status: 400,
      data: {
        data: {
          code: "validation_json_size_limit",
          message: "The maximum allowed JSON size is 1048576 bytes.",
          params: { maxSize: 1048576 },
        },
        message: "Failed to update record.",
      },
    });
    const harness = makeManageHarness({ taskRows: [], failSnapshotWriteWith: pbError });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-write-fail",
      task: { title: "Fails", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "snapshot_write_failed" });
    const calls = warn.mock.calls.map((call) => String(call[0]));
    const logged = calls.find((entry) => entry.includes("snapshot write failed"));
    expect(logged).toBeTruthy();
    expect(logged).toContain("status=400");
    expect(logged).toContain("The maximum allowed JSON size is 1048576 bytes.");
  });
});

describe("fat-then-slim cycle", () => {
  const fat = `data:image/webp;base64,${"D".repeat(250_000)}`;

  it("a snapshot write through the shared read path persists the slimmed blob, byte-identical on the next write", async () => {
    let stored: Row = {
      id: "snap-1",
      key: SNAPSHOT_KEY,
      data: {
        revision: "1",
        tasks: [
          {
            id: 7,
            title: "Fat legacy row",
            assigneeEmoji: fat,
            crew: { members: [{ name: "Emily", emoji: fat, joinedAt: "x" }] },
          },
        ],
        deletedTaskIds: [],
      },
      updated_at: "2026-10-01T00:00:00.000Z",
    };
    const updates: Row[] = [];
    const pb = {
      collection: vi.fn((name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: vi.fn(async () => [structuredClone(stored)]),
            update: vi.fn(async (_id: string, payload: Row) => {
              stored = { ...structuredClone(stored), ...structuredClone(payload) };
              updates.push(structuredClone(payload));
              return structuredClone(stored);
            }),
            create: vi.fn(async (payload: Row) => {
              stored = { ...structuredClone(payload) };
              updates.push(structuredClone(payload));
              return structuredClone(stored);
            }),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    await mutateSnapshotWithMeta((data) => ({ data, result: null }), pb as any);
    expect(updates).toHaveLength(1);
    const slimmed = (updates[0].data as Row).tasks[0];
    expect(slimmed.assigneeEmoji).toBe("👤");
    expect(slimmed.crew.members[0].emoji).toBe("👤");
    expect(JSON.stringify(slimmed).length).toBeLessThan(5_000);

    await mutateSnapshotWithMeta((data) => ({ data, result: null }), pb as any);
    expect(updates).toHaveLength(2);
    const firstData = { ...(updates[0].data as Row), revision: undefined };
    const secondData = { ...(updates[1].data as Row), revision: undefined };
    expect(secondData).toEqual(firstData);
  });

  it("a fat snapshot task reconciles without rewriting the snapshot and settles across runs", async () => {
    const WEEK = "2026-09-21";
    const fatTask = {
      id: 42,
      title: "Fat Task",
      assignee: "Child Test",
      assigneeEmoji: fat,
      assigned: "Child Test",
      due: WEEK,
      points: 5,
      recurring: null,
      category: "chores",
      priority: "medium",
      universal: false,
      stealable: false,
      completed: false,
      completedBy: null,
      completedAt: null,
      completedInWeek: null,
      pendingApproval: null,
      sentBackAt: null,
      crewSize: null,
      crew: null,
      speedBonus: null,
    };
    const snapshot: Row = {
      id: "snap-1",
      key: SNAPSHOT_KEY,
      data: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [fatTask],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      updated_at: "",
    };
    const weekRows: Row[] = [
      { id: "week-1", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
    ];
    const taskRows: Row[] = [];
    let snapshotWrites = 0;
    const pb = {
      collection: (name: string) => ({
        getFullList: async () => {
          if (name === "consuela_data_snapshots") return [structuredClone(snapshot)];
          if (name === "week_data") return structuredClone(weekRows);
          if (name === "week_archive") return [];
          if (name === "tasks") return structuredClone(taskRows);
          if (name === "members") {
            return [
              { id: "parent-1", name: "Parent Test", role: "parent", emoji: "🧑" },
              { id: "child-1", name: "Child Test", role: "child", emoji: "🧒" },
            ];
          }
          return [];
        },
        create: async (payload: Row) => {
          if (name === "consuela_data_snapshots") {
            snapshotWrites += 1;
            Object.assign(snapshot, structuredClone(payload));
            return structuredClone(snapshot);
          }
          if (name === "tasks") {
            const row = { id: `pb-${taskRows.length + 1}`, ...structuredClone(payload) };
            taskRows.push(row);
            return structuredClone(row);
          }
          return structuredClone(payload);
        },
        update: async (id: string, payload: Row) => {
          if (name === "consuela_data_snapshots") {
            snapshotWrites += 1;
            Object.assign(snapshot, structuredClone(payload));
            return structuredClone(snapshot);
          }
          if (name === "tasks") {
            const row = taskRows.find((candidate) => candidate.id === id);
            if (row) Object.assign(row, structuredClone(payload));
            return row ?? structuredClone(payload);
          }
          return structuredClone(payload);
        },
        delete: async () => true,
      }),
    };
    const run = () => reconcileTaskProjectionLocked(pb as any, { weekStart: WEEK });

    const first = await run();
    expect(first.failed).toEqual([]);
    expect(snapshotWrites).toBe(0);
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].assigneeEmoji).toBe("👤");

    const second = await run();
    expect(second.failed).toEqual([]);
    expect(second.repaired).toEqual([]);
    expect(snapshotWrites).toBe(0);
  });
});

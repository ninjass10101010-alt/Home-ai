// Three kid-safe reads (Hall of Fame, Skill Tree, Time Capsules) and the two
// honest `live*` readers behind them.
//
// Two of the three services were NOT safe to call from a tool as they stand:
// `getSkillTreeProfile` CREATES a profile row on a miss and falls back to the
// legacy `demo-user` row (another member's XP), and `getUserCapsules` returned
// `[]` for BOTH "no capsules" and "read failed". A chat tool that wraps either
// one lies. These tests pin the honest readers underneath them.
import { describe, it, expect, vi, beforeEach } from "vitest";

// One fake PocketBase records every MUTATION, so "this read never writes" is a
// real assertion rather than an assumption.
const h = vi.hoisted(() => {
  const rows: Record<string, any[]> = {};
  const failReads = new Set<string>();
  const writes: Array<{ op: string; collection: string; data?: any }> = [];

  // PB filters are OR'd clauses; a clause is one `field = "v"` / `field ?~ "v"`
  // / `field = true` term. Enough to honor the compound visibility filters these
  // reads actually issue.
  const clauseMatches = (row: any, clause: string): boolean => {
    const text = clause.trim();
    const quoted = /^([A-Za-z_][\w.]*)\s*(\?~|=|=~)\s*"([^"]*)"$/.exec(text);
    if (quoted) {
      const value = row[quoted[1]];
      if (Array.isArray(value)) {
        return quoted[2] === "?~"
          ? value.some((v) => String(v).includes(quoted[3]))
          : value.map(String).includes(quoted[3]);
      }
      const asText = String(value ?? "");
      return quoted[2] === "?~" ? asText.includes(quoted[3]) : asText === quoted[3];
    }
    const bool = /^([A-Za-z_][\w.]*)\s*=\s*(true|false)$/.exec(text);
    if (bool) return row[bool[1]] === (bool[2] === "true");
    return true;
  };
  const matches = (row: any, filter?: string): boolean => {
    if (!filter) return true;
    return filter
      .split("||")
      .map((clause) => clause.trim().replace(/^\(/, "").replace(/\)$/, ""))
      .some((clause) => clauseMatches(row, clause));
  };

  const collection = (name: string) => ({
    getList: async (_page: number, _perPage: number, opts: any = {}) => {
      if (failReads.has(name)) throw new Error(`read failed: ${name}`);
      const items = (rows[name] ?? []).filter((r: any) => matches(r, opts?.filter));
      return { items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 };
    },
    getFullList: async (opts: any = {}) => {
      if (failReads.has(name)) throw new Error(`read failed: ${name}`);
      return (rows[name] ?? []).filter((r: any) => matches(r, opts?.filter));
    },
    getOne: async (id: string) => {
      const row = (rows[name] ?? []).find((r: any) => r.id === id);
      if (!row) throw new Error(`not found: ${id}`);
      return row;
    },
    getFirstListItem: async (filter: string) => {
      const row = (rows[name] ?? []).find((r: any) => matches(r, filter));
      if (!row) throw new Error("not found");
      return row;
    },
    create: async (data: any) => {
      writes.push({ op: "create", collection: name, data });
      const record = { id: `created-${name}-${(rows[name] ?? []).length + 1}`, ...data };
      if (!rows[name]) rows[name] = [];
      rows[name].push(record);
      return record;
    },
    update: async (id: string, data: any) => {
      writes.push({ op: "update", collection: name, data });
      const row = (rows[name] ?? []).find((r: any) => r.id === id);
      if (row) Object.assign(row, data);
      return row ?? { id, ...data };
    },
    delete: async (id: string) => {
      writes.push({ op: "delete", collection: name, data: { id } });
      return true;
    },
  });

  const pb = { collection };

  return {
    rows,
    failReads,
    writes,
    pb,
    // PB auth is its own failure mode: the throwing reader must log it too,
    // not just a failed query.
    failAuth: false,
    reset() {
      for (const key of Object.keys(rows)) delete rows[key];
      failReads.clear();
      writes.length = 0;
      (h as any).failAuth = false;
    },
  };
});

vi.mock("@/lib/pb-auth", () => ({
  // The real withAdmin authenticates before handing over the client
  // (ensureAuth), so expired/missing admin creds throw from it too — not just
  // from getAuthedPB.
  withAdmin: async (fn: any) => {
    if (h.failAuth) throw new Error("pb auth down");
    return fn(h.pb);
  },
  getAuthedPB: async () => {
    if (h.failAuth) throw new Error("pb auth down");
    return h.pb;
  },
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => {
      throw new Error("STALE CACHE READ — must use live reads");
    },
    selectPendingTasks: () => {
      throw new Error("STALE CACHE READ — must use live reads");
    },
    selectTodaysSchedulesRaw: () => {
      throw new Error("STALE CACHE READ — must use live reads");
    },
    selectMeals: async () => [],
    selectPantry: async () => [],
    selectGrocery: async () => [],
    selectMembers: () => [],
    selectRecipes: async () => [],
  },
}));

import * as liveReads from "@/lib/consuela/live-reads";
import { getUserCapsules, readUserCapsules } from "@/lib/time-capsule";
import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";

const KID = { source: "hermes" as const, caller: { memberId: "emily", name: "Emily", role: "child" } };
const PARENT = { source: "hermes" as const, caller: { memberId: "rebecca", name: "Rebecca", role: "parent" } };

// The RAW payload the model actually receives. Assertions about "what the model
// can see" must use this: `JSON.stringify(null)` is "null", so an assertion
// built from a null result can never fail.
async function runToolRaw(name: string, args: Record<string, any> = {}, context?: any) {
  const tool = getTool(name);
  expect(tool, `tool "${name}" must be registered`).toBeDefined();
  return tool!.handler(args, context);
}

async function runTool(name: string, args: Record<string, any> = {}, context?: any) {
  return JSON.parse(await runToolRaw(name, args, context));
}

const profile = (over: Record<string, any> = {}) => ({
  id: "p",
  userId: "member",
  totalXP: 0,
  level: 1,
  xpToNextLevel: 100,
  unlockedBranches: [],
  completedQuests: [],
  activeQuests: [],
  achievementCount: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: "",
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => h.reset());

describe("get_skill_tree — a kid always gets their OWN tree, read-only", () => {
  it("never reports the legacy demo-user profile as the caller's own XP", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999, level: 9 })];

    const res = await runTool("get_skill_tree", {}, KID);

    expect(res.profile.totalXP).not.toBe(999);
    expect(res.profile.totalXP).toBe(0);
    expect(res.profile.userId).toBe("Emily");
  });

  it("creates no PocketBase row when the member has no profile yet", async () => {
    h.rows.skill_tree_profiles = [];

    const res = await runTool("get_skill_tree", {}, KID);

    expect(res.profile.totalXP).toBe(0);
    expect(res.profile.userId).toBe("Emily");
    // The packaged getSkillTreeProfile CREATES here — a read tool must not.
    expect(h.writes).toEqual([]);
    expect(h.rows.skill_tree_profiles).toHaveLength(0);
  });

  it("leaves PocketBase untouched across a whole skill-tree read", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 })];
    h.rows.skill_branches = [
      { id: "b1", name: "Math Explorer", icon: "🔢", unlockLevel: 1, unlockXP: 0, prerequisiteBranches: [], order: 0 },
    ];
    h.rows.quests = [
      { id: "q1", branchId: "b1", title: "Read a book", type: "read", difficulty: "easy", xpReward: 10, order: 0 },
    ];

    const res = await runTool("get_skill_tree", {}, KID);

    expect(res.branches).toHaveLength(1);
    expect(res.quests).toHaveLength(1);
    expect(res.xpProgress).toMatchObject({ percentage: expect.any(Number) });
    expect(h.writes).toEqual([]);
  });

  it("sanitizes a branch icon that carries a photo data URL", async () => {
    h.rows.skill_branches = [
      { id: "b1", name: "Math Explorer", icon: `data:image/png;base64,${"C".repeat(2000)}`, unlockLevel: 1, unlockXP: 0, prerequisiteBranches: [], order: 0 },
    ];
    h.rows.quests = [];

    const raw = await runToolRaw("get_skill_tree", {}, KID);

    expect(raw).not.toContain("data:image");
    expect(JSON.parse(raw).branches[0].icon).toBe("👤");
  });

  it("ignores a model-supplied member name — a kid's tree is always their own", async () => {
    h.rows.skill_tree_profiles = [
      profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 }),
      profile({ id: "emily-1", userId: "Emily", totalXP: 10 }),
      profile({ id: "rebecca-1", userId: "Rebecca", totalXP: 500 }),
    ];

    const res = await runTool("get_skill_tree", { member: "Rebecca" }, KID);

    expect(res.profile.totalXP).toBe(10);
    expect(res.profile.userId).toBe("Emily");
  });

  it("lets a parent ask about another member", async () => {
    h.rows.skill_tree_profiles = [
      profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 }),
      profile({ id: "emily-1", userId: "Emily", totalXP: 10 }),
      profile({ id: "rebecca-1", userId: "Rebecca", totalXP: 500 }),
    ];

    const res = await runTool("get_skill_tree", { member: "Emily" }, PARENT);

    expect(res.profile.totalXP).toBe(10);
  });

  it("defaults to the parent's OWN tree with no member argument", async () => {
    h.rows.skill_tree_profiles = [
      profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 }),
      profile({ id: "rebecca-1", userId: "Rebecca", totalXP: 500 }),
    ];

    const res = await runTool("get_skill_tree", {}, PARENT);

    expect(res.profile.totalXP).toBe(500);
  });

  it("reports a failed catalog read instead of a confident empty tree", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "emily-1", userId: "Emily", totalXP: 10 })];
    h.rows.quests = [{ id: "q1", branchId: "b1", title: "Read a book", type: "read", difficulty: "easy", xpReward: 10, order: 0 }];
    h.failReads.add("skill_branches");

    const res = await runTool("get_skill_tree", {}, KID);

    // "There are no branches yet" and "we could not look" must not read the same
    // to a kid asking "what can I unlock?".
    expect(res.error).toMatch(/do not guess/i);
    expect(res.branches).toBeUndefined();
    expect(res.quests).toBeUndefined();
  });

  it("treats a failed quest read as a failed catalog too", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "emily-1", userId: "Emily", totalXP: 10 })];
    h.rows.skill_branches = [{ id: "b1", name: "Math Explorer", icon: "🔢", unlockLevel: 1, unlockXP: 0, prerequisiteBranches: [], order: 0 }];
    h.failReads.add("quests");

    const res = await runTool("get_skill_tree", {}, KID);

    expect(res.error).toMatch(/do not guess/i);
    expect(res.quests).toBeUndefined();
  });

  it("reports an honestly empty catalog (read succeeded) with no error", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "emily-1", userId: "Emily", totalXP: 10 })];
    h.rows.skill_branches = [];
    h.rows.quests = [];

    const res = await runTool("get_skill_tree", {}, KID);

    expect(res.error).toBeUndefined();
    expect(res.branches).toEqual([]);
    expect(res.quests).toEqual([]);
    expect(res.profile.totalXP).toBe(10);
  });

  it("fails closed when there is no caller — never falls back to the shared legacy row", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 })];

    for (const context of [undefined, { source: "hermes" as const }, { source: "hermes" as const, caller: { memberId: "", name: "  ", role: "child" } }]) {
      const raw = await runToolRaw("get_skill_tree", {}, context);
      // Checked on the raw payload — a re-stringified parse of a null would be
      // "null" and pass no matter what leaked.
      expect(raw).not.toContain("999");
      expect(raw).not.toContain("demo-user");
      const res = JSON.parse(raw);
      expect(res.error).toBeTruthy();
      expect(res.profile).toBeUndefined();
    }
  });
});

describe("readSkillTreeProfile — never creates, never serves the legacy namespace", () => {
  it("exists as a read-only reader", () => {
    expect(typeof (liveReads as any).readSkillTreeProfile).toBe("function");
  });

  it("returns null when the read fails instead of a fabricated zero profile", async () => {
    h.failReads.add("skill_tree_profiles");

    expect(await (liveReads as any).readSkillTreeProfile("Emily")).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("refuses the legacy demo-user namespace outright", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 })];

    const res = await (liveReads as any).readSkillTreeProfile("demo-user");

    expect(res).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("refuses a blank id, which sanitizeUserId would turn into demo-user", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 })];

    expect(await (liveReads as any).readSkillTreeProfile("")).toBeNull();
    expect(await (liveReads as any).readSkillTreeProfile("   ")).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("returns the member's exact row when they have one", async () => {
    h.rows.skill_tree_profiles = [
      profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 }),
      profile({ id: "emily-1", userId: "Emily", totalXP: 10 }),
    ];

    const res = await (liveReads as any).readSkillTreeProfile("Emily");

    expect(res.id).toBe("emily-1");
    expect(res.totalXP).toBe(10);
    expect(h.writes).toEqual([]);
  });
});

describe("liveSkillCatalog — the honest catalog reader behind get_skill_tree", () => {
  it("exists as a live reader", () => {
    expect(typeof (liveReads as any).liveSkillCatalog).toBe("function");
  });

  it("returns null when the branches read fails", async () => {
    h.failReads.add("skill_branches");

    expect(await (liveReads as any).liveSkillCatalog()).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("returns null when the quests read fails", async () => {
    h.failReads.add("quests");

    expect(await (liveReads as any).liveSkillCatalog()).toBeNull();
  });

  it("returns null when the PocketBase auth itself fails", async () => {
    h.failAuth = true;

    expect(await (liveReads as any).liveSkillCatalog()).toBeNull();
  });

  it("returns empty arrays — NOT null — for a genuinely empty catalog", async () => {
    h.rows.skill_branches = [];
    h.rows.quests = [];

    const res = await (liveReads as any).liveSkillCatalog();

    expect(res).not.toBeNull();
    expect(res).toEqual({ branches: [], quests: [] });
  });

  it("returns the real rows when both reads succeed", async () => {
    h.rows.skill_branches = [{ id: "b1", name: "Math Explorer", order: 0 }];
    h.rows.quests = [{ id: "q1", branchId: "b1", title: "Read a book" }];

    const res = await (liveReads as any).liveSkillCatalog();

    expect(res.branches.map((b: any) => b.id)).toEqual(["b1"]);
    expect(res.quests.map((q: any) => q.id)).toEqual(["q1"]);
    expect(h.writes).toEqual([]);
  });
});

describe("get_time_capsules — honest degradation", () => {
  const capsule = (over: Record<string, any> = {}) => ({
    id: "cap-1",
    title: "For Emily in 2030",
    unlockDate: "2030-01-01T00:00:00.000Z",
    createdBy: "Emily",
    recipients: ["Emily"],
    isFamilyWide: false,
    status: "locked",
    contentCount: 2,
    ...over,
  });

  it("reports the read failure instead of a confident empty list", async () => {
    h.failReads.add("time_capsules");

    const res = await runTool("get_time_capsules", {}, KID);

    expect(res.error).toMatch(/do not guess/i);
    expect(res.capsules).toEqual([]);
  });

  it("distinguishes a genuinely empty collection from a failed read", async () => {
    h.rows.time_capsules = [];

    const res = await runTool("get_time_capsules", {}, KID);

    expect(res.error).toBeUndefined();
    expect(res.capsules).toEqual([]);
  });

  it("returns the caller's capsules on a healthy read", async () => {
    h.rows.time_capsules = [capsule()];

    const res = await runTool("get_time_capsules", {}, KID);

    expect(res.error).toBeUndefined();
    expect(res.capsules.map((c: any) => c.title)).toEqual(["For Emily in 2030"]);
  });

  it("ignores a model-supplied member name — a kid sees their own capsules only", async () => {
    h.rows.time_capsules = [capsule(), capsule({ id: "cap-2", title: "Rebecca's secret", createdBy: "Rebecca", recipients: ["Rebecca"] })];

    const res = await runTool("get_time_capsules", { member: "Rebecca" }, KID);

    expect(res.capsules.map((c: any) => c.title)).toEqual(["For Emily in 2030"]);
  });

  it("fails closed without a caller rather than reading the shared legacy namespace", async () => {
    h.rows.time_capsules = [capsule({ createdBy: "demo-user", recipients: ["demo-user"] })];

    for (const context of [undefined, { source: "hermes" as const, caller: { memberId: "", name: "", role: "child" } }]) {
      const res = await runTool("get_time_capsules", {}, context);
      expect(res.error).toBeTruthy();
      expect(res.capsules).toEqual([]);
      expect(JSON.stringify(res)).not.toContain("demo-user");
    }
  });
});

describe("readUserCapsules — the throwing reader behind liveTimeCapsules", () => {
  it("exists alongside the []-returning wrapper", () => {
    expect(typeof readUserCapsules).toBe("function");
    expect(typeof getUserCapsules).toBe("function");
  });

  it("propagates a read failure so callers can tell it from an empty collection", async () => {
    h.failReads.add("time_capsules");

    await expect(readUserCapsules("Emily")).rejects.toThrow(/read failed/);
  });

  it("logs a PocketBase AUTH failure too — no silent throw", async () => {
    h.failAuth = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(readUserCapsules("Emily")).rejects.toThrow(/auth down/);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("leaves getUserCapsules' existing []-on-failure contract intact", async () => {
    h.failReads.add("time_capsules");

    await expect(getUserCapsules("Emily")).resolves.toEqual([]);
  });

  it("liveTimeCapsules maps the throwing reader onto the null = read failed idiom", async () => {
    h.rows.time_capsules = [{ id: "cap-1", title: "Sealed", createdBy: "Emily", recipients: ["Emily"], isFamilyWide: false }];

    const failed = h.failReads;
    failed.add("time_capsules");
    expect(await (liveReads as any).liveTimeCapsules("Emily")).toBeNull();
    failed.delete("time_capsules");

    expect(await (liveReads as any).liveTimeCapsules("Emily")).toHaveLength(1);
  });
});

describe("get_hall_of_fame — photo avatars must never reach the provider", () => {
  const hallRow = (over: Record<string, any> = {}) => ({
    id: "h1",
    member: "Emily",
    emoji: "🎻",
    weekStart: "2026-09-07",
    points: 40,
    rank: 1,
    ...over,
  });

  it("sanitizes photo avatars via textEmoji", async () => {
    h.rows.hall_of_fame = [
      hallRow({ emoji: `data:image/png;base64,${"A".repeat(2000)}` }),
    ];

    const res = await runTool("get_hall_of_fame", {}, KID);

    expect(JSON.stringify(res)).not.toContain("data:image");
    expect(res.entries[0].emoji).toBe("👤");
  });

  it("keeps a text glyph and strips the payload size of a photo-avatar family", async () => {
    h.rows.hall_of_fame = [
      ...[1, 2, 3, 4, 5].map((n) =>
        hallRow({ id: `h${n}`, member: `Kid ${n}`, emoji: `data:image/png;base64,${"B".repeat(200000)}` }),
      ),
    ];

    const res = await runTool("get_hall_of_fame", {}, KID);

    expect(res.entries.every((e: any) => e.emoji === "👤")).toBe(true);
    // A single base64 avatar is ~200KB; the serialized result must stay tiny.
    expect(JSON.stringify(res).length).toBeLessThan(1000);
  });

  it("returns the newest weeks first with rank, points and prize", async () => {
    h.rows.hall_of_fame = [
      hallRow({ id: "old", weekStart: "2026-08-31", rank: 2, points: 20, prize: "" }),
      hallRow({ id: "new", weekStart: "2026-09-07", rank: 1, points: 40, prize: "Movie night" }),
    ];

    const res = await runTool("get_hall_of_fame", {}, KID);

    expect(res.entries.map((e: any) => e.weekStart)).toEqual(["2026-09-07", "2026-08-31"]);
    expect(res.entries[0]).toMatchObject({ member: "Emily", rank: 1, points: 40, prize: "Movie night" });
  });

  it("reports a failed read instead of a confident empty hall", async () => {
    h.failReads.add("hall_of_fame");

    const res = await runTool("get_hall_of_fame", {}, KID);

    // "Nobody is enshrined" and "we could not look" must not look the same to
    // a kid asking "am I in the hall of fame?".
    expect(res.error).toMatch(/do not guess/i);
    expect(res.count).toBe(0);
    expect(res.entries).toEqual([]);
  });

  it("reports an honestly empty hall (read succeeded) with no error", async () => {
    h.rows.hall_of_fame = [];

    const res = await runTool("get_hall_of_fame", {}, KID);

    expect(res.error).toBeUndefined();
    expect(res.count).toBe(0);
    expect(res.entries).toEqual([]);
  });

  it("orders a multi-podium week by rank, not by PocketBase's return order", async () => {
    h.rows.hall_of_fame = [
      hallRow({ id: "third", member: "Emily", rank: 3, points: 10 }),
      hallRow({ id: "first", member: "Rebecca", rank: 1, points: 30 }),
      hallRow({ id: "second", member: "Bailey", rank: 2, points: 20 }),
    ];

    const res = await runTool("get_hall_of_fame", {}, KID);

    // Same weekStart, so the week sort alone leaves PB's order — rank 3 first.
    expect(res.entries.map((e: any) => e.rank)).toEqual([1, 2, 3]);
  });
});

describe("kid tool surface", () => {
  it("all three reads are on the kid surface", () => {
    const kid = buildToolsForOpenAI({ role: "child" }).map((t) => t.function.name);
    expect(kid).toEqual(
      expect.arrayContaining(["get_hall_of_fame", "get_skill_tree", "get_time_capsules"]),
    );
  });
});

// A redemption is a point DEDUCTION, so the tool that proposes one must be as
// inert as propose_point_adjustment: it reads the live shop, prices the chip,
// and returns a proposal — /api/rewards/redeem is the only thing that spends
// points, and it re-verifies the PIN itself. `h.writes` records every PocketBase
// create/update/delete, so "writes nothing" is asserted, not assumed.
describe("propose_reward_redemption", () => {
  const seedReward = (over: Record<string, any> = {}) => {
    h.rows.rewards = [{ id: "7", name: "Movie night", cost: 25, emoji: "🎬", ...over }];
    return h.rows.rewards[0];
  };
  const seedMember = () => {
    h.rows.members = [{ id: "m1", fullName: "Emily G", name: "Emily", role: "child" }];
  };
  const propose = (args: Record<string, any>, context: any = PARENT) =>
    runTool("propose_reward_redemption", args, context);

  beforeEach(() => {
    seedMember();
  });

  it("validates only and returns an inert, operation-keyed proposal — nothing is written", async () => {
    seedReward();

    const res = await propose({ member: "Emily", reward: "Movie night", reason: "helped all week" });

    expect(res.ok).toBe(true);
    expect(res.proposal.tool).toBe("redeem_reward");
    // The operation id IS the retry identity the redeem route validates first —
    // without it a retry redeems twice.
    expect(res.proposal.operationId).toMatch(/^task-op-/);
    expect(res.proposal.args).toMatchObject({
      member: "Emily G",
      reward: "Movie night",
      rewardId: "7",
      cost: 25,
      reason: "helped all week",
    });
    // The copy is load-bearing: the model must say this is PENDING.
    expect(res.message).toMatch(/NOT been redeemed/);
    expect(res.message).toMatch(/PIN/);
    expect(res.message).toMatch(/never state the redemption as done/);
    expect(h.writes).toEqual([]);
    expect(h.rows.rewards).toHaveLength(1);
  });

  it("leaves PocketBase untouched even when the caller is a grown-up with a real session", async () => {
    seedReward();

    await propose({ member: "Emily", reward: "Movie night", reason: "great week" }, PARENT);

    expect(h.writes).toEqual([]);
  });

  it("prices the chip exactly as get_rewards quotes the same row", async () => {
    // A legacy row with no `cost` is why the fallback exists at all.
    seedReward({ name: "Ice cream", cost: undefined, points: 15 });

    const res = await propose({ member: "Emily", reward: "ice cream", reason: "hot day" });
    const shop = await runTool("get_rewards", {}, PARENT);
    const listed = shop.rewards.find((r: any) => r.title === "Ice cream");

    expect(res.proposal.args.cost).toBe(15);
    expect(res.proposal.args.cost).toBe(listed.cost);
    expect(h.writes).toEqual([]);
  });

  // A row with neither field has no price the redeem route could charge
  // (`Number(row.cost ?? row.points)` → NaN → "invalid_cost"), so offering a
  // chip for it spends the family's attention on a redemption that must fail.
  it("refuses a reward the shop cannot price instead of proposing a 0-pt redemption", async () => {
    seedReward({ name: "Ghost entry", cost: undefined, points: undefined });

    const res = await propose({ member: "Emily", reward: "Ghost entry", reason: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no cost/i);
    expect(res.proposal).toBeUndefined();
    expect(h.writes).toEqual([]);
  });

  it("refuses an unknown reward and names the tool that lists the real set", async () => {
    seedReward();

    const res = await propose({ member: "Emily", reward: "Private jet", reason: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/get_rewards/);
    expect(res.proposal).toBeUndefined();
    expect(h.writes).toEqual([]);
  });

  it("refuses an unknown member instead of guessing who earns the reward", async () => {
    seedReward();

    const res = await propose({ member: "Zoe", reward: "Movie night", reason: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/get_family_members/);
    expect(res.proposal).toBeUndefined();
    expect(h.writes).toEqual([]);
  });

  it("reports a failed catalog read instead of proposing a redemption it cannot price", async () => {
    seedReward();
    h.failReads.add("rewards");

    const res = await propose({ member: "Emily", reward: "Movie night", reason: "great week" });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not guess/i);
    expect(res.proposal).toBeUndefined();
    expect(h.writes).toEqual([]);
  });

  it("requires a member, a reward and a reason before it touches anything", async () => {
    seedReward();

    const missingMember = await propose({ reward: "Movie night", reason: "x" });
    const missingReward = await propose({ member: "Emily", reason: "x" });
    const missingReason = await propose({ member: "Emily", reward: "Movie night" });
    const longReason = await propose({ member: "Emily", reward: "Movie night", reason: "x".repeat(201) });

    expect(missingMember.error).toMatch(/get_family_members/);
    expect(missingReward.error).toMatch(/get_rewards/);
    expect(missingReason.error).toMatch(/reason is required/i);
    expect(longReason.error).toMatch(/200 characters or fewer/);
    for (const res of [missingMember, missingReward, missingReason, longReason]) {
      expect(res.proposal).toBeUndefined();
    }
    expect(h.writes).toEqual([]);
  });

  it("refuses to guess when two shop entries share the name", async () => {
    h.rows.rewards = [
      { id: "7", name: "Movie night", cost: 25 },
      { id: "8", name: "Movie night", cost: 40 },
    ];

    const res = await propose({ member: "Emily", reward: "Movie night", reason: "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/2 rewards/);
    expect(res.proposal).toBeUndefined();
    expect(h.writes).toEqual([]);
  });

  // The handler takes NO caller gate (deliberately — it moves no points), so the
  // tool list is the only thing keeping it out of a child's hands.
  it("is offered to a parent and never to a child", () => {
    const parent = buildToolsForOpenAI({ role: "parent" }).map((t) => t.function.name);
    const kid = buildToolsForOpenAI({ role: "child" }).map((t) => t.function.name);

    expect(parent).toContain("propose_reward_redemption");
    expect(kid).not.toContain("propose_reward_redemption");
  });
});

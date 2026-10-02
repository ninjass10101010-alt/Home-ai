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
    reset() {
      for (const key of Object.keys(rows)) delete rows[key];
      failReads.clear();
      writes.length = 0;
    },
  };
});

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: any) => fn(h.pb),
  getAuthedPB: async () => h.pb,
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

async function runTool(name: string, args: Record<string, any> = {}, context?: any) {
  const tool = getTool(name);
  expect(tool, `tool "${name}" must be registered`).toBeDefined();
  return JSON.parse(await tool!.handler(args, context));
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

  it("fails closed when there is no caller — never falls back to the shared legacy row", async () => {
    h.rows.skill_tree_profiles = [profile({ id: "legacy-1", userId: "demo-user", totalXP: 999 })];

    for (const context of [undefined, { source: "hermes" as const }, { source: "hermes" as const, caller: { memberId: "", name: "  ", role: "child" } }]) {
      const res = await runTool("get_skill_tree", {}, context);
      expect(res.error).toBeTruthy();
      expect(res.profile).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain("999");
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
    expect(JSON.stringify(res)).not.toContain("999");
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

  it("degrades to an empty hall when the read fails, without inventing winners", async () => {
    h.failReads.add("hall_of_fame");

    const res = await runTool("get_hall_of_fame", {}, KID);

    expect(res.entries).toEqual([]);
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
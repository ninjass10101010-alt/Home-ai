// Task 15 — propose_point_adjustment: the chat NEVER moves points. The tool
// validates and returns an inert proposal; every write path must stay zero
// (the only way points move is the parent's PIN on the confirm chip, which
// hits /api/consuela/planner/apply — covered by planner-apply-route.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Record<string, any[]> = {};
const writes: Array<{ op: string; collection: string; id?: string; data?: any }> = [];
let membersFail = false;

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async () => {
        if (name === "members" && membersFail) throw new Error("PB down");
        return rows[name] ?? [];
      },
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (_id: string, d: any) => { writes.push({ op: "update", collection: name, data: d }); return { id: _id, ...d }; },
      create: async (d: any) => { writes.push({ op: "create", collection: name, data: d }); return { id: "n1", ...d }; },
      delete: async (id: string) => { writes.push({ op: "delete", collection: name, id }); return true; },
    }),
  })),
}));
vi.mock("@/db", () => ({ db: new Proxy({}, { get: () => async () => [] }) }));

import { getTool } from "@/lib/hermes-tools";

const TOOL = () => getTool("propose_point_adjustment");

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  writes.length = 0;
  membersFail = false;
  rows.members = [
    { id: 1, name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" },
    { id: 2, name: "Rebecca", fullName: "Rebecca G", role: "parent", emoji: "🐱" },
  ];
});

describe("propose_point_adjustment — validate only, never write", () => {
  it("is registered in the tool surface", () => {
    expect(TOOL()).toBeDefined();
  });

  it("valid proposal: resolves the member to the ledger name, echoes delta/reason, writes NOTHING", async () => {
    const out = JSON.parse(await TOOL()!.handler({ member: "Emily", delta: 10, reason: "helping carry groceries" }));
    expect(out.ok).toBe(true);
    expect(out.proposal).toEqual({
      tool: "adjust_points",
      args: { member: "Emily G", delta: 10, reason: "helping carry groceries" },
    });
    expect(String(out.message)).toMatch(/parent/i);
    expect(String(out.message)).toMatch(/PIN/i);
    expect(writes).toHaveLength(0);
  });

  it("negative deltas are proposals too (never applied here)", async () => {
    const out = JSON.parse(await TOOL()!.handler({ member: "Emily G", delta: -5, reason: "left the door open" }));
    expect(out.ok).toBe(true);
    expect(out.proposal.args.delta).toBe(-5);
    expect(writes).toHaveLength(0);
  });

  it("unknown member → refusal that names get_family_members, zero writes", async () => {
    const out = JSON.parse(await TOOL()!.handler({ member: "Zoe", delta: 10, reason: "being nice" }));
    expect(out.ok).toBeFalsy();
    expect(String(out.error)).toContain("get_family_members");
    expect(out.proposal).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it("unavailable roster fails honestly (no guessing), zero writes", async () => {
    membersFail = true;
    const out = JSON.parse(await TOOL()!.handler({ member: "Emily", delta: 10, reason: "helped" }));
    expect(out.ok).toBeFalsy();
    expect(String(out.error)).toMatch(/unavailable/i);
    expect(writes).toHaveLength(0);
  });

  it("delta must be an integer in -100..100 and never 0", async () => {
    for (const delta of [0, 101, -101, 2.5, "ten", null, undefined, ""]) {
      const out = JSON.parse(await TOOL()!.handler({ member: "Emily", delta, reason: "helped" }));
      expect(out.ok, `delta=${JSON.stringify(delta)} must be refused`).toBeFalsy();
      expect(out.proposal).toBeUndefined();
    }
    expect(writes).toHaveLength(0);
  });

  it("reason must be non-empty and at most 200 chars", async () => {
    for (const reason of ["", "   ", "x".repeat(201)]) {
      const out = JSON.parse(await TOOL()!.handler({ member: "Emily", delta: 10, reason }));
      expect(out.ok, `reason=${JSON.stringify(reason.slice(0, 8))}… must be refused`).toBeFalsy();
      expect(out.proposal).toBeUndefined();
    }
    const ok = JSON.parse(await TOOL()!.handler({ member: "Emily", delta: 10, reason: "x".repeat(200) }));
    expect(ok.ok).toBe(true);
    expect(writes).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const mocks = vi.hoisted(() => ({ pb: null as any }));

vi.mock("@/lib/pb-auth", () => ({ getAuthedPB: async () => mocks.pb }));

import { listActivePlaybooks, getPlaybook, writePlaybook, patchPlaybook, archivePlaybook } from "@/lib/memory-playbooks";

function fakePb() {
  return {
    collection: () => ({
      getFirstListItem: async (filter: string) => {
        const slug = /slug = "([^"]+)"/.exec(filter)?.[1];
        const found = rows.find((r) => r.slug === slug);
        if (!found) throw new Error("not found");
        return found;
      },
      getFullList: async ({ filter }: any) => {
        if (filter && filter.includes('status != "archived"')) return rows.filter((r) => r.status !== "archived");
        return rows.slice();
      },
      create: async (data: any) => { const row = { id: `p${rows.length + 1}`, version: 1, status: "active", useCount: 0, history: [], ...data }; rows.push(row); return row; },
      update: async (id: string, data: any) => { const row = rows.find((r) => r.id === id)!; Object.assign(row, data); return row; },
      getOne: async (id: string) => rows.find((r) => r.id === id)!,
    }),
  };
}

beforeEach(() => { rows.length = 0; mocks.pb = fakePb(); });

describe("writePlaybook", () => {
  it("creates an active playbook at version 1", async () => {
    const created = await writePlaybook({ slug: "meals.add_emoji", title: "Attach a meal emoji", body: "Use a relevant emoji, default 🍽️." });
    expect(created?.version).toBe(1);
    expect(created?.status).toBe("active");
    expect(rows).toHaveLength(1);
  });

  it("REPLACES the body of an existing slug and keeps the old body in history", async () => {
    await writePlaybook({ slug: "meals.add_emoji", title: "Attach a meal emoji", body: "Use a relevant emoji, default 🍽️." });
    const updated = await writePlaybook({ slug: "meals.add_emoji", title: "Attach a meal emoji", body: "Never use the soup emoji unless it is soup." });
    expect(rows).toHaveLength(1);
    expect(updated?.version).toBe(2);
    expect(updated?.body).toBe("Never use the soup emoji unless it is soup.");
    expect(updated?.history).toHaveLength(1);
    expect(updated?.history[0].body).toContain("relevant emoji");
  });
});

describe("listActivePlaybooks", () => {
  it("hides archived playbooks", async () => {
    await writePlaybook({ slug: "a", title: "A", body: "a" });
    await writePlaybook({ slug: "b", title: "B", body: "b" });
    await archivePlaybook("b");
    const list = await listActivePlaybooks();
    expect(list.map((p) => p.slug)).toEqual(["a"]);
  });
});

describe("getPlaybook", () => {
  it("reads one playbook by slug", async () => {
    await writePlaybook({ slug: "meals.add_emoji", title: "Attach a meal emoji", body: "body" });
    const row = await getPlaybook("meals.add_emoji");
    expect(row?.body).toBe("body");
  });
});

describe("patchPlaybook", () => {
  it("replaces the body and bumps the version", async () => {
    await writePlaybook({ slug: "meals.add_emoji", title: "Attach a meal emoji", body: "one" });
    const patched = await patchPlaybook("meals.add_emoji", "two");
    expect(patched?.body).toBe("two");
    expect(patched?.version).toBe(2);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { records: [] as any[], calls: [] as any[] };
  const collectionMock = {
    getFullList: async () => state.records.map(r => ({ ...r })),
    create: async (data: any) => {
      state.calls.push(["create", data]);
      const rec = { id: `pb_${state.records.length + 1}`, ...data };
      state.records.push(rec);
      return { ...rec };
    },
    update: async (id: string, data: any) => {
      state.calls.push(["update", id, data]);
      const rec = state.records.find(r => r.id === id);
      if (!rec) throw new Error("404 not found");
      Object.assign(rec, data);
      return { ...rec };
    },
    delete: async (id: string) => {
      state.calls.push(["delete", id]);
      const idx = state.records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error("404 not found");
      state.records.splice(idx, 1);
    },
  };
  // Distinct PUBLIC client: under LOCKED_RULES the server-side safe* helpers
  // must never touch it — every call would 403 and silently fall back.
  const publicCalls: string[] = [];
  const publicCollectionMock = {
    getFullList: async () => { publicCalls.push("getFullList"); throw new Error("403 locked"); },
    getOne: async () => { publicCalls.push("getOne"); throw new Error("403 locked"); },
    create: async () => { publicCalls.push("create"); throw new Error("403 locked"); },
    update: async () => { publicCalls.push("update"); throw new Error("403 locked"); },
    delete: async () => { publicCalls.push("delete"); throw new Error("403 locked"); },
  };
  const adminFlags = { used: false, failNext: false };
  return { state, collectionMock, publicCalls, publicCollectionMock, adminFlags };
});

vi.mock("@/lib/pb", () => ({
  getPB: () => ({ collection: () => h.publicCollectionMock }),
  getAdminPB: () => ({ collection: () => h.collectionMock }),
}));

// MF-2 — mock the admin wrapper so tests can prove the safe* helpers route
// through it (and observe graceful fallback when it fails).
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: any) => {
    if (h.adminFlags.failNext) throw new Error("admin unavailable");
    h.adminFlags.used = true;
    return fn({ collection: () => h.collectionMock });
  },
}));

import { db } from "@/db/pb-db";

describe("pb-db grocery id handling", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.calls = [];
    h.publicCalls.length = 0;
    h.adminFlags.used = false;
    h.adminFlags.failNext = false;
  });

  it("updates the record matched by id and omits id from the payload", async () => {
    h.state.records.push({ id: "pb_1", name: "Milk", needed: true });
    const saved = await db.upsertGroceryItem({ id: "pb_1", name: "Milk", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toBe("pb_1");
    expect(updateCall![2]).not.toHaveProperty("id");
    expect(saved?.needed).toBe(false);
  });

  it("falls back to name matching when no id is provided", async () => {
    h.state.records.push({ id: "pb_2", name: "Eggs", needed: true });
    await db.upsertGroceryItem({ name: "eggs", needed: false });
    const updateCall = h.state.calls.find(c => c[0] === "update");
    expect(updateCall![1]).toBe("pb_2");
  });

  it("creates a new record without id in the payload when nothing matches", async () => {
    const saved = await db.upsertGroceryItem({ name: "Bread", needed: true });
    const createCall = h.state.calls.find(c => c[0] === "create");
    expect(createCall).toBeTruthy();
    expect(createCall![1]).not.toHaveProperty("id");
    expect(saved?.id).toBeTruthy();
  });

  it("deleteGroceryItem removes the record by string id", async () => {
    h.state.records.push({ id: "pb_3", name: "Butter" });
    const ok = await db.deleteGroceryItem("pb_3");
    expect(ok).toBe(true);
    expect(h.state.records).toHaveLength(0);
  });

  it("deleteGroceryItem returns false for an unknown id instead of throwing", async () => {
    const ok = await db.deleteGroceryItem("does_not_exist");
    expect(ok).toBe(false);
  });
});

// MF-2 — after LOCKED_RULES every app collection is admin-only, so the safe*
// helpers' server execution path must use the superuser client. The public
// client would 403 on everything and silently degrade (worst case:
// /api/emergency read placeholder contacts and alerts vanished).
describe("pb-db lockdown routing (server path uses admin client)", () => {
  beforeEach(() => {
    h.state.records = [];
    h.state.calls = [];
    h.publicCalls.length = 0;
    h.adminFlags.used = false;
    h.adminFlags.failNext = false;
  });

  it("selectEmergencyContacts reads via the admin client, never the public one", async () => {
    h.state.records.push({ id: "ec1", name: "Mom", phone: "+15550000001", isPrimary: true });
    const contacts = await db.selectEmergencyContacts();

    expect(h.adminFlags.used).toBe(true);
    expect(h.publicCalls).toEqual([]);
    expect(contacts).toHaveLength(1);
    expect((contacts[0] as any).phone).toBe("+15550000001");
  });

  it("grocery reads/writes also ride the admin client", async () => {
    h.state.records.push({ id: "g1", name: "Milk", needed: true });
    const saved = await db.upsertGroceryItem({ id: "g1", name: "Milk", needed: false });

    expect(h.adminFlags.used).toBe(true);
    expect(h.publicCalls).toEqual([]);
    expect(saved?.needed).toBe(false);
  });

  it("degrades to placeholder fallback contacts when the admin path fails", async () => {
    h.adminFlags.failNext = true;
    const contacts = await db.selectEmergencyContacts();

    // emergencyFallback placeholders — the documented worst case, still honest.
    expect(contacts.length).toBeGreaterThan(0);
    expect((contacts[0] as any).phone).toBe("+15551234567");
  });

  it("auth-session helpers keep a working path server-side too", async () => {
    h.state.records.push({ id: "s1", token: "dev_123", memberName: "Caspian" });
    const session = await db.findAuthSession("dev_123");

    expect(h.adminFlags.used).toBe(true);
    expect(h.publicCalls).toEqual([]);
    expect(session?.memberName).toBe("Caspian");
  });
});

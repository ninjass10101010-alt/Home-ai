import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: mocks.withAdmin,
}));

import {
  __resetPinThrottleForTests,
  findMemberByName,
  listMembersSanitized,
  updateMemberRecordByActorId,
  verifyPinAgainstAnyMember,
  verifyPinFromPB,
} from "@/lib/server-auth";
import { POST as profilePOST } from "@/app/api/members/profile/route";
import { POST as pinPOST } from "@/app/api/members/pin/route";

const CANONICAL_OPT_IN = "NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS";

function pbReturningMembers(members: any[]) {
  return {
    collection: () => ({
      getFullList: async () => members,
    }),
  };
}

function profileRequest(body: unknown) {
  return new NextRequest("http://localhost/api/members/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pinRequest(body: unknown) {
  return new NextRequest("http://localhost/api/members/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The identity read succeeds, the subsequent update read does not contain the
// actor — exactly the "PB no longer has this member" race.
function withAdminRosterThenEmptyUpdate(roster: any[]) {
  let calls = 0;
  mocks.withAdmin.mockImplementation(async (fn: (p: unknown) => Promise<unknown>) => {
    calls += 1;
    return fn(pbReturningMembers(calls === 1 ? roster : []));
  });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  __resetPinThrottleForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production identity is PocketBase only", () => {
  it("does not synthesize a production credential", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbReturningMembers([
          { id: "m1", name: "Parent One", role: "parent", pin: "" },
        ]),
      ),
    );

    await expect(
      verifyPinFromPB("Parent One", "not-a-real-pin"),
    ).resolves.toBeNull();
  });

  it("never creates a deleted actor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const create = vi.fn();
    const update = vi.fn();
    const pb = {
      collection: () => ({
        getFullList: async () => [],
        create,
        update,
      }),
    };

    await expect(
      updateMemberRecordByActorId(
        pb,
        { id: "deleted", name: "Deleted Child", role: "child", emoji: "🧒" },
        { emoji: "🦊" },
      ),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a pin-less PocketBase row unpinned in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbReturningMembers([
          { id: "m7", name: "Caspian", role: "child", pin: "" },
        ]),
      ),
    );

    const member = await findMemberByName("Caspian");

    expect(member).not.toBeNull();
    expect(member.pin).toBe("");
  });

  it("never merges canonical rows into a production roster", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbReturningMembers([
          { id: "m7", name: "Caspian", role: "child", pin: "stored-only" },
        ]),
      ),
    );

    const members = await listMembersSanitized();

    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("m7");
    expect(members[0].pin).toBeUndefined();
  });

  it("returns no canonical members for an empty PocketBase read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(pbReturningMembers([])),
    );

    await expect(listMembersSanitized()).resolves.toEqual([]);
    await expect(
      verifyPinAgainstAnyMember("not-a-real-pin"),
    ).resolves.toBeNull();
  });

  it("returns no canonical members when PocketBase has no usable rows", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn(
        pbReturningMembers([
          { id: "m8", name: "   ", role: "child", pin: "stored-only" },
        ]),
      ),
    );

    await expect(listMembersSanitized()).resolves.toEqual([]);
    await expect(
      verifyPinAgainstAnyMember("not-a-real-pin"),
    ).resolves.toBeNull();
  });

  it("fails closed when the PocketBase read is rejected", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          getFullList: async () => {
            throw new Error("pocketbase unreachable");
          },
        }),
      }),
    );

    await expect(listMembersSanitized()).rejects.toThrow();
    await expect(
      verifyPinAgainstAnyMember("not-a-real-pin"),
    ).rejects.toThrow();
    await expect(findMemberByName("Caspian")).rejects.toThrow();
  });

  it("updates the record matching the actor id", async () => {
    const update = vi.fn(async (id: string, patch: Record<string, unknown>) => ({
      id,
      name: "Caspian",
      role: "child",
      emoji: patch.emoji,
    }));
    const create = vi.fn();
    const pb = {
      collection: () => ({
        getFullList: async () => [
          { id: "other", name: "Caspian", role: "child", emoji: "🧒" },
          { id: "m7", name: "Caspian Garcia", role: "child", emoji: "🧒" },
        ],
        create,
        update,
      }),
    };

    const updated = await updateMemberRecordByActorId(
      pb,
      { id: "m7", name: "Caspian", role: "child", emoji: "🧒" },
      { emoji: "🦊" },
    );

    expect(updated).toEqual({ id: "m7", name: "Caspian", role: "child", emoji: "🦊" });
    expect(update).toHaveBeenCalledWith("m7", { emoji: "🦊" });
    expect(create).not.toHaveBeenCalled();
  });

  it("never falls back to name matching when the actor id is gone", async () => {
    const create = vi.fn();
    const update = vi.fn();
    const pb = {
      collection: () => ({
        getFullList: async () => [
          { id: "other", name: "Caspian", role: "child", emoji: "🧒" },
        ],
        create,
        update,
      }),
    };

    await expect(
      updateMemberRecordByActorId(
        pb,
        { id: "m7", name: "Caspian", role: "child", emoji: "🧒" },
        { emoji: "🦊" },
      ),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("answers 401 identity_unavailable for a profile update of a vanished actor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    withAdminRosterThenEmptyUpdate([
      { id: "m1", name: "Parent One", role: "parent", pin: "fixture-only-pin" },
    ]);

    const res = await profilePOST(
      profileRequest({
        actorName: "Parent One",
        actorPin: "fixture-only-pin",
        patch: { emoji: "🐼" },
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
  });

  it("answers 401 identity_unavailable for a PIN update of a vanished actor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CANONICAL_OPT_IN, "true");
    withAdminRosterThenEmptyUpdate([
      { id: "m1", name: "Parent One", role: "parent", pin: "fixture-only-pin" },
    ]);

    const res = await pinPOST(
      pinRequest({
        actorName: "Parent One",
        actorPin: "fixture-only-pin",
        newPin: "9753",
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
  });
});

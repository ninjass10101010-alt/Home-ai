/**
 * Money-mountain WRITE gate + field allowlist.
 *
 * Bug A: `PATCH /api/money-mountain/[id]` forwarded the raw request body
 * straight into PocketBase behind nothing but `requireSession` + an ownership
 * check that treats the shared `demo-user` namespace as owned-by-everyone. A
 * child or a pet session could therefore set `currentAmount` on any legacy
 * mountain and then withdraw it.
 *
 * This suite drives the REAL `requireLiveSession` against a mocked PocketBase
 * identity read (only the PB seam is replaced), so "a child is refused", "a pet
 * is refused", "a PocketBase outage fails closed" and "a stale cookie role is
 * refused" are proved through the shipped helper — not through a stub of it.
 * Only the money-mountain write seam (`@/lib/money-mountain`) is a recorder,
 * so the assertion "this exact object reached the database" is exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  getMountain: vi.fn(),
  updateMountain: vi.fn(),
  deleteMountain: vi.fn(),
  addTransaction: vi.fn(),
  createMountain: vi.fn(),
  getUserMountains: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/money-mountain", () => ({
  getMountain: (...args: unknown[]) => mocks.getMountain(...args),
  updateMountain: (...args: unknown[]) => mocks.updateMountain(...args),
  deleteMountain: (...args: unknown[]) => mocks.deleteMountain(...args),
  addTransaction: (...args: unknown[]) => mocks.addTransaction(...args),
  createMountain: (...args: unknown[]) => mocks.createMountain(...args),
  getUserMountains: (...args: unknown[]) => mocks.getUserMountains(...args),
}));

import {
  PATCH,
  DELETE,
  POST as TRANSACTION_POST,
} from "@/app/api/money-mountain/[id]/route";
import { POST as CREATE_POST } from "@/app/api/money-mountain/route";
import { SESSION_COOKIE, signSession } from "@/lib/session";

const MOUNTAIN_ID = "mtn-fixture-1";

// The legacy shared namespace: `isLegacyOwner("demo-user")` is true, so before
// the fix EVERY session passed the ownership check on every pre-migration row.
const LEGACY_MOUNTAIN = {
  mountain: {
    id: MOUNTAIN_ID,
    userId: "demo-user",
    name: "New Bike",
    targetAmount: 100,
    currentAmount: 40,
    currency: "USD",
  },
  milestones: [],
  transactions: [],
};

function memberRow(role: string, id = `m-${role}`) {
  return { id, name: `${role} Person`, role, pin: "", phone: "private" };
}

function pbWithMembers(rows: Array<Record<string, unknown>>) {
  return {
    collection: (name: string) => ({
      getOne: async (id: string) => {
        if (name !== "members") throw { status: 404 };
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw { status: 404 };
        return row;
      },
    }),
  };
}

function pbOutage() {
  return {
    collection: () => ({
      getOne: async () => {
        throw new Error("PocketBase is unreachable");
      },
    }),
  };
}

type Role = "parent" | "child" | "pet";

async function sessionCookie(role: Role | null, signedRole: Role = role as Role) {
  if (!role) return "";
  const token = await signSession({
    memberId: `m-${role}`,
    name: `${role} Person`,
    role: signedRole,
  });
  return `${SESSION_COOKIE}=${token}`;
}

async function mountainReq(
  method: "PATCH" | "DELETE" | "POST",
  role: Role | null,
  body: unknown,
  path = `/api/money-mountain/${MOUNTAIN_ID}`,
) {
  const cookie = await sessionCookie(role);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function createReq(role: Role | null, body: unknown) {
  const cookie = await sessionCookie(role);
  return new NextRequest("http://localhost/api/money-mountain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The exact patch object handed to PocketBase by the last PATCH call. */
function patchArgument(): Record<string, unknown> {
  expect(mocks.updateMountain).toHaveBeenCalledTimes(1);
  return mocks.updateMountain.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  vi.stubEnv("SESSION_SECRET", "money-mountain-gate-fixture-secret");
  mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("parent")])));
  mocks.getMountain.mockResolvedValue(LEGACY_MOUNTAIN);
  mocks.updateMountain.mockResolvedValue({ ...LEGACY_MOUNTAIN.mountain, name: "Renamed" });
  mocks.deleteMountain.mockResolvedValue(true);
  mocks.createMountain.mockResolvedValue({ id: "mtn-new", name: "New Mountain" });
  mocks.addTransaction.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/money-mountain/[id] — parent-only gate", () => {
  it("refuses a child session before it can even read the mountain", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("child")])));

    const response = await PATCH(
      await mountainReq("PATCH", "child", { currentAmount: 1000 }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.getMountain).not.toHaveBeenCalled();
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("refuses a pet session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("pet")])));

    const response = await PATCH(
      await mountainReq("PATCH", "pet", { currentAmount: 1000 }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("refuses a request with no session cookie at all", async () => {
    const response = await PATCH(await mountainReq("PATCH", null, { name: "x" }), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(401);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("fails closed when the live PocketBase identity cannot be read", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbOutage()));

    const response = await PATCH(
      await mountainReq("PATCH", "parent", { name: "Renamed" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "identity_unavailable" });
    expect(mocks.getMountain).not.toHaveBeenCalled();
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("refuses a stale cookie whose role no longer matches the live row", async () => {
    mocks.withAdmin.mockImplementation((fn) =>
      fn(pbWithMembers([memberRow("child", "m-parent")])),
    );

    const response = await PATCH(
      await mountainReq("PATCH", "parent", { name: "Renamed" }, undefined),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "session_role_changed" });
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("lets a live parent rename a legacy demo-user mountain (F8a continuity)", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", { name: "Renamed Bike" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(200);
    expect(patchArgument()).toEqual({ name: "Renamed Bike" });
  });

  it("still refuses a parent who does not own the mountain", async () => {
    mocks.getMountain.mockResolvedValue({
      ...LEGACY_MOUNTAIN,
      mountain: { ...LEGACY_MOUNTAIN.mountain, userId: "Somebody Else" },
    });

    const response = await PATCH(
      await mountainReq("PATCH", "parent", { name: "Renamed Bike" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/money-mountain/[id] — field allowlist", () => {
  const serverOwned = [
    "id",
    "userId",
    "currentAmount",
    "percentageComplete",
    "milestoneIndex",
    "daysActive",
    "matchedAmount",
    "matchedBy",
    "totalDeposits",
    "totalWithdrawals",
    "transactionCount",
    "isCompleted",
    "completedAt",
    "created",
    "updated",
  ];

  for (const field of serverOwned) {
    it(`refuses a body that tries to set the server-owned field \`${field}\``, async () => {
      const response = await PATCH(
        await mountainReq("PATCH", "parent", { name: "Fine", [field]: 999 }),
        { params: Promise.resolve({ id: MOUNTAIN_ID }) },
      );

      expect(response.status).toBe(400);
      expect(mocks.updateMountain).not.toHaveBeenCalled();
    });
  }

  it("writes only the allowlisted fields the caller actually sent", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", {
        name: "Bike",
        targetAmount: 250,
        currency: "EUR",
        mountainTheme: "forest",
        matchEnabled: true,
        matchPercentage: 50,
        description: "A real goal",
      }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(200);
    expect(patchArgument()).toEqual({
      name: "Bike",
      targetAmount: 250,
      currency: "EUR",
      mountainTheme: "forest",
      matchEnabled: true,
      matchPercentage: 50,
      description: "A real goal",
    });
  });

  it("ignores inherited Object.prototype keys rather than writing them", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", { name: "Bike" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(200);
    expect(Object.keys(patchArgument())).toEqual(["name"]);
    expect(patchArgument()).not.toHaveProperty("constructor");
    expect(patchArgument()).not.toHaveProperty("__proto__");
  });

  it.each([
    ["targetAmount as a string", { targetAmount: "250" }],
    ["a zero target", { targetAmount: 0 }],
    ["a negative target", { targetAmount: -5 }],
    ["a match above 100", { matchPercentage: 500 }],
    ["a non-integer match", { matchPercentage: 12.5 }],
    ["an unknown currency", { currency: "XYZ" }],
    ["an unknown theme", { mountainTheme: "lava" }],
    ["an empty name", { name: "   " }],
    ["a non-boolean matchEnabled", { matchEnabled: "yes" }],
    ["a non-date deadline", { deadline: "someday" }],
  ])("refuses %s", async (_label, body) => {
    const response = await PATCH(await mountainReq("PATCH", "parent", body), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("refuses `status: completed` — completion is derived from the balance", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", { status: "completed" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("allows a parent to pause and resume a goal", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", { status: "paused" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(200);
    expect(patchArgument()).toEqual({ status: "paused" });
  });

  it("refuses an empty patch", async () => {
    const response = await PATCH(await mountainReq("PATCH", "parent", {}), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an object", async () => {
    const response = await PATCH(
      await mountainReq("PATCH", "parent", ["not", "an", "object"]),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateMountain).not.toHaveBeenCalled();
  });
});

describe("POST /api/money-mountain/[id]/transaction — parent-only gate", () => {
  const deposit = { type: "deposit", amount: 10, description: "Chore", source: "chore" };

  it("refuses a child session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("child")])));

    const response = await TRANSACTION_POST(await mountainReq("POST", "child", deposit), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.getMountain).not.toHaveBeenCalled();
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it("refuses a pet session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("pet")])));

    const response = await TRANSACTION_POST(await mountainReq("POST", "pet", deposit), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it("fails closed on a PocketBase identity outage", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbOutage()));

    const response = await TRANSACTION_POST(await mountainReq("POST", "parent", deposit), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(503);
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it("lets a live parent deposit", async () => {
    const response = await TRANSACTION_POST(await mountainReq("POST", "parent", deposit), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(201);
    expect(mocks.addTransaction).toHaveBeenCalledWith(
      MOUNTAIN_ID,
      "parent Person",
      expect.objectContaining({ type: "deposit", amount: 10, description: "Chore", source: "chore" }),
    );
  });

  it("refuses a caller-supplied `match` type — match rows are server-generated", async () => {
    const response = await TRANSACTION_POST(
      await mountainReq("POST", "parent", {
        type: "match",
        amount: 500,
        description: "Free money",
        source: "match",
      }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it("refuses an unknown transaction source", async () => {
    const response = await TRANSACTION_POST(
      await mountainReq("POST", "parent", { ...deposit, source: "lottery" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric or non-positive amount", async () => {
    for (const amount of ["10", 0, -5, Number.NaN]) {
      mocks.addTransaction.mockClear();
      const response = await TRANSACTION_POST(
        await mountainReq("POST", "parent", { ...deposit, amount }),
        { params: Promise.resolve({ id: MOUNTAIN_ID }) },
      );
      expect(response.status).toBe(400);
      expect(mocks.addTransaction).not.toHaveBeenCalled();
    }
  });

  it("refuses a transaction missing description", async () => {
    const response = await TRANSACTION_POST(
      await mountainReq("POST", "parent", { type: "deposit", amount: 10, source: "chore" }),
      { params: Promise.resolve({ id: MOUNTAIN_ID }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/money-mountain/[id] — parent-only gate", () => {
  it("refuses a child session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("child")])));

    const response = await DELETE(await mountainReq("DELETE", "child", {}), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.deleteMountain).not.toHaveBeenCalled();
  });

  it("refuses a pet session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("pet")])));

    const response = await DELETE(await mountainReq("DELETE", "pet", {}), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.deleteMountain).not.toHaveBeenCalled();
  });

  it("lets a live parent delete their own mountain", async () => {
    const response = await DELETE(await mountainReq("DELETE", "parent", {}), {
      params: Promise.resolve({ id: MOUNTAIN_ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.deleteMountain).toHaveBeenCalledWith(MOUNTAIN_ID);
  });
});

describe("POST /api/money-mountain — parent-only gate", () => {
  const newMountain = { name: "New Mountain", targetAmount: 100 };

  it("refuses a child session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("child")])));

    const response = await CREATE_POST(await createReq("child", newMountain));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.createMountain).not.toHaveBeenCalled();
  });

  it("refuses a pet session", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbWithMembers([memberRow("pet")])));

    const response = await CREATE_POST(await createReq("pet", newMountain));

    expect(response.status).toBe(403);
    expect(mocks.createMountain).not.toHaveBeenCalled();
  });

  it("fails closed on a PocketBase identity outage", async () => {
    mocks.withAdmin.mockImplementation((fn) => fn(pbOutage()));

    const response = await CREATE_POST(await createReq("parent", newMountain));

    expect(response.status).toBe(503);
    expect(mocks.createMountain).not.toHaveBeenCalled();
  });

  it("lets a live parent create a goal with a zeroed balance", async () => {
    const response = await CREATE_POST(await createReq("parent", newMountain));

    expect(response.status).toBe(201);
    const [, payload] = mocks.createMountain.mock.calls[0];
    expect(payload).not.toHaveProperty("currentAmount");
  });
});

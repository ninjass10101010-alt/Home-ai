// POST /api/hall-of-fame/celebrate — the weekly-win ceremony claim.
// hall_of_fame gateway writes are PARENT-policy (a child session gets a 403
// from /api/db/*), so the claim goes through this sessioned server route:
// child/pet sessions may celebrate ONLY their own win; parents may claim for
// any member (dismissing the modal for an absent kid). Idempotent — a
// re-claim on an already-celebrated row is a 200 no-op.
// Harness mirrors tests/unit/rewards-redeem-route.test.ts: mock the PB seam
// (withAdmin), the member lookup, and the session verifier.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  findMemberByName: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  findMemberByName: (name: string) => mocks.findMemberByName(name),
  // Faithful copy of the pure matcher in src/lib/server-auth.ts (kept real so
  // the ownership check is tested against the same matching rules).
  namesMatch: (recordName: string, query: string) => {
    const firstName = query.split(" ")[0];
    return (
      recordName === query ||
      recordName.startsWith(`${query} `) ||
      recordName.split(" ")[0] === query ||
      recordName === firstName ||
      firstName.startsWith(recordName)
    );
  },
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: (token?: string) => mocks.verifySession(token),
}));

import { POST } from "@/app/api/hall-of-fame/celebrate/route";

const KID = { id: "m-cas", name: "Caspian Garcia", role: "child" };
const MOM = { id: "m-reb", name: "Rebecca Garcia", role: "parent" };

// Session-cookie convention for this suite: "role|full name|memberId".
const KID_COOKIE = "child|Caspian Garcia|m-cas";
const MOM_COOKIE = "parent|Rebecca Garcia|m-reb";

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/hall-of-fame/celebrate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `consuela_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function hallRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "hof-1",
    member: "Caspian Garcia",
    emoji: "🦊",
    weekStart: "2026-09-07",
    points: 42,
    rank: 1,
    prize: "Picks the movie",
    ...overrides,
  };
}

function makePb(rows: any[]) {
  const updates: { id: string; patch: any }[] = [];
  const pb = {
    collection: (name: string) => {
      if (name !== "hall_of_fame") throw new Error(`unexpected collection: ${name}`);
      return {
        getFullList: async () => rows,
        update: async (id: string, patch: any) => {
          updates.push({ id, patch });
          const row = rows.find((r) => r.id === id);
          if (row) Object.assign(row, patch);
          return row ?? null;
        },
      };
    },
  };
  mocks.withAdmin.mockImplementation((fn: (p: unknown) => Promise<unknown>) => fn(pb));
  return { updates, rows };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.findMemberByName.mockReset();
  mocks.verifySession.mockReset();
  mocks.verifySession.mockImplementation(async (token?: string) => {
    if (!token || token === "bogus") return null;
    const [role, name, memberId] = token.split("|");
    return { role, name, memberId };
  });
  mocks.findMemberByName.mockImplementation(async (name: string) => {
    const roster: Record<string, any> = {
      "Caspian Garcia": KID,
      "Rebecca Garcia": MOM,
    };
    return roster[name] ?? null;
  });
});

describe("POST /api/hall-of-fame/celebrate", () => {
  it("401s when there is no session cookie", async () => {
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }));
    expect(res.status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("401s an invalid session", async () => {
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }, "bogus"));
    expect(res.status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("400s when memberName or weekStart is missing", async () => {
    const noName = await POST(req({ weekStart: "2026-09-07" }, KID_COOKIE));
    expect(noName.status).toBe(400);
    const noWeek = await POST(req({ memberName: "Caspian Garcia" }, KID_COOKIE));
    expect(noWeek.status).toBe(400);
    expect(mocks.findMemberByName).not.toHaveBeenCalled();
  });

  it("404s when the member does not exist", async () => {
    const res = await POST(req({ memberName: "Nobody Here", weekStart: "2026-09-07" }, KID_COOKIE));
    expect(res.status).toBe(404);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("403s a child claiming ANOTHER member's win", async () => {
    const { updates } = makePb([hallRow({ member: "Rebecca Garcia" })]);
    const res = await POST(req({ memberName: "Rebecca Garcia", weekStart: "2026-09-07" }, KID_COOKIE));
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("404s when the member has no prized podium win for that week", async () => {
    // Rank 4 and a prize-less rank 2 both fail the "rank ≤ 3 + non-empty
    // prize" gate; wrong weekStart likewise.
    const { updates } = makePb([
      hallRow({ id: "hof-r4", weekStart: "2026-09-07", rank: 4 }),
      hallRow({ id: "hof-noprize", weekStart: "2026-09-07", rank: 2, prize: "" }),
      hallRow({ id: "hof-old", weekStart: "2026-08-31" }),
    ]);
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }, KID_COOKIE));
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it("lets a child celebrate their OWN win and sets celebrated on the PB row", async () => {
    const { updates, rows } = makePb([hallRow()]);
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }, KID_COOKIE));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("hof-1");
    expect(updates[0].patch).toEqual({ celebrated: true });
    expect(rows[0].celebrated).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entry.celebrated).toBe(true);
  });

  it("lets a PARENT claim for a kid (dismissing for an absent member)", async () => {
    const { updates } = makePb([hallRow()]);
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }, MOM_COOKIE));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ celebrated: true });
  });

  it("is idempotent — a re-claim on an already-celebrated row returns 200 without rewriting", async () => {
    const { updates, rows } = makePb([hallRow({ celebrated: true })]);
    const res = await POST(req({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }, KID_COOKIE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entry.celebrated).toBe(true);
    expect(updates).toHaveLength(0);
    expect(rows[0].celebrated).toBe(true);
  });
});

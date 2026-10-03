// C — the two remaining chat-thread writers must attribute and authorize from
// the LIVE PocketBase row, never the cookie's claim.
//
//   * POST /api/chat/messages (the "New conversation" divider) writes a
//     system-role row into the family's shared thread, attributed to
//     `session.name` — a 7-day cookie claim.
//   * POST /api/hall-of-fame/celebrate decides ownership AND the parent
//     allowlist from `session.role` / `session.memberId`, so a demoted parent
//     kept the right to claim any member's win.
//
// Both re-read the live row through `authorizeCurrentMemberRequest` — the same
// helper the db-gateway write routes use — and fail CLOSED when PocketBase
// cannot answer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  insertChatMessage: vi.fn(async () => ({})),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));

import { POST as chatMessagesPOST } from "@/app/api/chat/messages/route";
import { POST as celebratePOST } from "@/app/api/hall-of-fame/celebrate/route";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const PARENT = { id: "m1", name: "Rebecca Garcia", role: "parent" };
const DEMOTED = { id: "m1", name: "Rebecca Garcia", role: "child" };
const KID = { id: "m2", name: "Caspian Garcia", role: "child" };

function serveLiveRows(rows: Record<string, any>[], opts: { outage?: boolean } = {}) {
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => {
    if (opts.outage) throw new Error("PB unreachable");
    return fn({
      collection: () => ({
        getOne: async (id: string) => {
          const row = rows.find((r) => String(r.id) === String(id));
          if (!row) throw Object.assign(new Error("not found"), { status: 404 });
          return { ...row };
        },
        getFullList: async () => rows.map((r) => ({ ...r })),
        update: async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }),
      }),
    });
  });
}

async function cookieFor(memberId: string, name: string, role: string) {
  return `${SESSION_COOKIE}=${await signSession({ memberId, name, role })}`;
}

function resetReq(cookie?: string) {
  return new NextRequest("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ action: "reset" }),
  });
}

function celebrateReq(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/hall-of-fame/celebrate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  serveLiveRows([PARENT, KID]);
  mocks.insertChatMessage.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("C — POST /api/chat/messages attributes the divider to the LIVE member", () => {
  it("writes the reset marker under the live row's name, not the cookie's claim", async () => {
    const res = await chatMessagesPOST(resetReq(await cookieFor(PARENT.id, "Stale Name", "parent")));
    expect(res.status).toBe(200);
    expect(mocks.insertChatMessage).toHaveBeenCalledTimes(1);
    expect((mocks.insertChatMessage.mock.calls[0] as any[])[0].userId).toBe(PARENT.name);
  });

  it("fails CLOSED when PocketBase cannot answer — no divider is written", async () => {
    serveLiveRows([], { outage: true });
    const res = await chatMessagesPOST(resetReq(await cookieFor(PARENT.id, PARENT.name, "parent")));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("still refuses a request with no session", async () => {
    const res = await chatMessagesPOST(resetReq());
    expect(res.status).toBe(401);
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("still refuses a cookie whose live row is gone", async () => {
    serveLiveRows([]);
    const res = await chatMessagesPOST(resetReq(await cookieFor(PARENT.id, PARENT.name, "parent")));
    expect(res.status).toBe(401);
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });
});

describe("C — POST /api/hall-of-fame/celebrate authorizes from the LIVE role", () => {
  const claim = { memberName: KID.name, weekStart: "2026-09-07" };
  /** Serve the roster with `actorRow` as the m1 identity, plus the kid's prize. */
  function servePrize(actorRow: Record<string, any> = PARENT) {
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: (name: string) => ({
          getOne: async (id: string) => {
            const row = [actorRow, KID].find((r) => String(r.id) === String(id));
            if (!row) throw Object.assign(new Error("not found"), { status: 404 });
            return { ...row };
          },
          getFullList: async () =>
            name === "hall_of_fame"
              ? [{ id: "hof-1", member: KID.name, weekStart: "2026-09-07", rank: 1, prize: "Ice cream" }]
              : [actorRow, KID].map((r) => ({ ...r })),
          update: async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }),
        }),
      }),
    );
  }

  it("a live parent may still claim a win for another member", async () => {
    servePrize();
    const res = await celebratePOST(celebrateReq(claim, await cookieFor(PARENT.id, PARENT.name, "parent")));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("a demoted parent may NOT claim another member's win", async () => {
    servePrize(DEMOTED);
    const res = await celebratePOST(celebrateReq(claim, await cookieFor(DEMOTED.id, DEMOTED.name, "parent")));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("a demoted parent may still claim their OWN win (ownership follows the live id)", async () => {
    const own = { memberName: DEMOTED.name, weekStart: "2026-09-07" };
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: (name: string) => ({
          getOne: async (id: string) => {
            const row = [DEMOTED, KID].find((r) => String(r.id) === String(id));
            if (!row) throw Object.assign(new Error("not found"), { status: 404 });
            return { ...row };
          },
          getFullList: async () =>
            name === "hall_of_fame"
              ? [{ id: "hof-2", member: DEMOTED.name, weekStart: "2026-09-07", rank: 2, prize: "Movie night" }]
              : [DEMOTED, KID].map((r) => ({ ...r })),
          update: async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }),
        }),
      }),
    );
    const res = await celebratePOST(celebrateReq(own, await cookieFor(DEMOTED.id, DEMOTED.name, "parent")));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("fails CLOSED when PocketBase cannot answer", async () => {
    serveLiveRows([], { outage: true });
    const res = await celebratePOST(celebrateReq(claim, await cookieFor(PARENT.id, PARENT.name, "parent")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("identity_unavailable");
  });

  it("still refuses a request with no session", async () => {
    const res = await celebratePOST(celebrateReq(claim));
    expect(res.status).toBe(401);
  });
});

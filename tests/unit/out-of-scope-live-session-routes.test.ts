import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

type RosterRow = { id: string; name: string; role: string; age?: number; pin?: string };

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  collections: [] as string[],
  hallUpdates: [] as { id: string; patch: Record<string, unknown> }[],
  memberUpdates: [] as { id: string; patch: Record<string, unknown> }[],
  hallRows: [] as any[],
  selectMorningBriefing: vi.fn(async () => null),
  ackMorningBriefing: vi.fn(async () => ({})),
  insertChatMessage: vi.fn(async (_row: Record<string, unknown>) => ({})),
  selectPendingSuggestions: vi.fn(async () => [] as any[]),
  getServiceConfig: vi.fn(async (_service: string, _key: string) => null as string | null),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/db", () => ({
  db: {
    selectMorningBriefing: mocks.selectMorningBriefing,
    ackMorningBriefing: mocks.ackMorningBriefing,
    insertChatMessage: mocks.insertChatMessage,
    selectPendingSuggestions: mocks.selectPendingSuggestions,
  },
}));

vi.mock("@/lib/services/config", () => ({
  getServiceConfig: mocks.getServiceConfig,
}));

import { POST as celebratePOST } from "@/app/api/hall-of-fame/celebrate/route";
import { POST as profilePOST } from "@/app/api/members/profile/route";
import { GET as briefingGET, PATCH as briefingPATCH } from "@/app/api/consuela/briefing/route";
import { POST as chatMessagesPOST } from "@/app/api/chat/messages/route";
import { GET as suggestionsGET } from "@/app/api/consuela/suggestions/route";
import { GET as runtimeGET } from "@/app/api/services/runtime/route";

let roster: Record<string, RosterRow> = {};

function fakePb() {
  return {
    collection: (name: string) => {
      mocks.collections.push(name);
      if (name === "members") {
        return {
          getOne: async (id: string) => {
            const row = roster[id];
            if (!row) throw { status: 404 };
            return { ...row };
          },
          getFullList: async () => Object.values(roster).map((row) => ({ ...row })),
          update: async (id: string, patch: Record<string, unknown>) => {
            mocks.memberUpdates.push({ id, patch });
            return { ...(roster[id] ?? { id }), ...patch };
          },
        };
      }
      if (name === "hall_of_fame") {
        return {
          getFullList: async () => mocks.hallRows,
          update: async (id: string, patch: Record<string, unknown>) => {
            mocks.hallUpdates.push({ id, patch });
            const row = mocks.hallRows.find((r: any) => r.id === id);
            if (row) Object.assign(row, patch);
            return row ?? null;
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

function request(url: string, init: RequestInit = {}, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { ...(init as any), headers }) as NextRequest;
}

async function sessionCookie(
  payload: { memberId: string; name: string; role: "parent" | "child" | "pet" },
  ttlSeconds?: number,
): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(payload, ttlSeconds)}`;
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

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  roster = {
    "m-reb": { id: "m-reb", name: "Rebecca Garcia", role: "parent", age: 40, pin: "9999" },
    "m-kid": { id: "m-kid", name: "Caspian Garcia", role: "child", age: 5, pin: "1111" },
  };
  mocks.collections.length = 0;
  mocks.hallUpdates.length = 0;
  mocks.memberUpdates.length = 0;
  mocks.hallRows = [hallRow()];
  mocks.withAdmin.mockReset().mockImplementation((fn: any) => fn(fakePb()));
  mocks.selectMorningBriefing.mockReset().mockResolvedValue(null);
  mocks.ackMorningBriefing.mockReset().mockResolvedValue({});
  mocks.insertChatMessage.mockReset().mockResolvedValue({});
  mocks.selectPendingSuggestions.mockReset().mockResolvedValue([]);
  mocks.getServiceConfig.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/hall-of-fame/celebrate — the signed-role allowlist is gone", () => {
  it("refuses a signed parent after live demotion and never touches hall_of_fame", async () => {
    roster["m-reb"].role = "child";

    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "session_role_changed" });
    expect(mocks.hallUpdates).toEqual([]);
    expect(new Set(mocks.collections)).toEqual(new Set(["members"]));
  });

  it("refuses a signed parent whose member row was deleted and never touches hall_of_fame", async () => {
    delete roster["m-reb"];

    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.hallUpdates).toEqual([]);
    expect(new Set(mocks.collections)).toEqual(new Set(["members"]));
  });

  it("refuses a revoked session and never touches hall_of_fame", async () => {
    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }, -60),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.hallUpdates).toEqual([]);
  });

  it("keeps the live-parent allowlist and the {celebrated:true} write", async () => {
    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.hallUpdates).toEqual([{ id: "hof-1", patch: { celebrated: true } }]);
  });

  it("refuses a live child whose name matches a DIFFERENT member row — ownership is by memberId", async () => {
    roster = {
      "m-reb": { id: "m-reb", name: "Rebecca Garcia", role: "parent", age: 40 },
      "m-kid-twin": { id: "m-kid-twin", name: "Caspian Garcia", role: "child", age: 7 },
      "m-kid": { id: "m-kid", name: "Caspian Garcia", role: "child", age: 5 },
    };

    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.hallUpdates).toEqual([]);
  });

  it("still lets a live child celebrate its OWN win by memberId", async () => {
    const response = await celebratePOST(
      request(
        "http://localhost/api/hall-of-fame/celebrate",
        {
          method: "POST",
          body: JSON.stringify({ memberName: "Caspian Garcia", weekStart: "2026-09-07" }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.hallUpdates).toEqual([{ id: "hof-1", patch: { celebrated: true } }]);
  });
});

describe("POST /api/members/profile — the child path is decided by the LIVE role", () => {
  it("refuses a demoted parent (no longer a live child) with the opaque PIN error and writes nothing", async () => {
    roster["m-reb"].role = "child";

    const response = await profilePOST(
      request(
        "http://localhost/api/members/profile",
        { method: "POST", body: JSON.stringify({ patch: { emoji: "🦊" } }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.memberUpdates).toEqual([]);
  });

  it("refuses a deleted member with the opaque PIN error and writes nothing", async () => {
    delete roster["m-kid"];

    const response = await profilePOST(
      request(
        "http://localhost/api/members/profile",
        { method: "POST", body: JSON.stringify({ patch: { emoji: "🦊" } }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.memberUpdates).toEqual([]);
  });

  it("still refuses a live PARENT session without a PIN", async () => {
    const response = await profilePOST(
      request(
        "http://localhost/api/members/profile",
        { method: "POST", body: JSON.stringify({ patch: { emoji: "🦊" } }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid PIN" });
    expect(mocks.memberUpdates).toEqual([]);
  });

  it("lets a live child save its own avatar, keyed on the live member id", async () => {
    const response = await profilePOST(
      request(
        "http://localhost/api/members/profile",
        { method: "POST", body: JSON.stringify({ patch: { emoji: "🦊" } }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.memberUpdates).toEqual([{ id: "m-kid", patch: { emoji: "🦊" } }]);
    const body = await response.json();
    expect(body.member.emoji).toBe("🦊");
    expect(body.member.pin).toBeUndefined();
  });
});

describe("/api/consuela/briefing — the ack records the LIVE name", () => {
  it("403s a PATCH from a signed parent after live demotion and never acks", async () => {
    roster["m-reb"].role = "child";

    const response = await briefingPATCH(
      request(
        "http://localhost/api/consuela/briefing",
        { method: "PATCH", body: JSON.stringify({ id: "b1" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.ackMorningBriefing).not.toHaveBeenCalled();
  });

  it("401s a PATCH from a deleted member and never acks", async () => {
    delete roster["m-reb"];

    const response = await briefingPATCH(
      request(
        "http://localhost/api/consuela/briefing",
        { method: "PATCH", body: JSON.stringify({ id: "b1" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.ackMorningBriefing).not.toHaveBeenCalled();
  });

  it("records the LIVE display name, not the signed one", async () => {
    roster["m-reb"].name = "Rebecca Renamed";

    const response = await briefingPATCH(
      request(
        "http://localhost/api/consuela/briefing",
        { method: "PATCH", body: JSON.stringify({ id: "b1" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.ackMorningBriefing).toHaveBeenCalledWith("b1", "Rebecca Renamed");
  });

  it("401s a guest GET and 403s a demoted GET without reading the briefing", async () => {
    const guest = await briefingGET(request("http://localhost/api/consuela/briefing"));
    expect(guest.status).toBe(401);
    expect(await guest.json()).toEqual({ error: "unauthorized" });

    roster["m-reb"].role = "child";
    const demoted = await briefingGET(
      request(
        "http://localhost/api/consuela/briefing",
        {},
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );
    expect(demoted.status).toBe(403);
    expect(mocks.selectMorningBriefing).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/messages — the reset marker records the LIVE name", () => {
  it("403s a demoted parent and writes no marker", async () => {
    roster["m-reb"].role = "child";

    const response = await chatMessagesPOST(
      request(
        "http://localhost/api/chat/messages",
        { method: "POST", body: JSON.stringify({ action: "reset" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("401s a revoked session and writes no marker", async () => {
    const response = await chatMessagesPOST(
      request(
        "http://localhost/api/chat/messages",
        { method: "POST", body: JSON.stringify({ action: "reset" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }, -60),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("records the LIVE name on the marker row", async () => {
    roster["m-reb"].name = "Rebecca Renamed";

    const response = await chatMessagesPOST(
      request(
        "http://localhost/api/chat/messages",
        { method: "POST", body: JSON.stringify({ action: "reset" }) },
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    const row = mocks.insertChatMessage.mock.calls[0][0];
    expect(row.userId).toBe("Rebecca Renamed");
    expect(row.role).toBe("system");
    expect(row.threadId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("GET /api/consuela/suggestions — the role filter reads the LIVE role", () => {
  const kidRow = { id: "t-1", kind: "task_penalty_streak", title: "Chores" };
  const parentRow = { id: "p-1", kind: "pantry_low", title: "Milk" };

  it("a demoted parent is NOT treated as a child (the signed role is never trusted)", async () => {
    roster["m-reb"].role = "child";
    mocks.selectPendingSuggestions.mockResolvedValue([parentRow, kidRow]);

    const response = await suggestionsGET(
      request(
        "http://localhost/api/consuela/suggestions?limit=20",
        {},
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.selectPendingSuggestions).toHaveBeenCalledWith({ limit: 20 });
    expect((await response.json()).items).toHaveLength(2);
  });

  it("a revoked session falls back to the guest shape, never to a child view", async () => {
    mocks.selectPendingSuggestions.mockResolvedValue([parentRow, kidRow]);

    const response = await suggestionsGET(
      request(
        "http://localhost/api/consuela/suggestions?limit=20",
        {},
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }, -60),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.selectPendingSuggestions).toHaveBeenCalledWith({ limit: 20 });
    expect((await response.json()).items).toHaveLength(2);
  });

  it("a live child still gets the wide fetch and the parent-only filter", async () => {
    mocks.selectPendingSuggestions.mockResolvedValue([parentRow, kidRow]);

    const response = await suggestionsGET(
      request(
        "http://localhost/api/consuela/suggestions?limit=20",
        {},
        await sessionCookie({ memberId: "m-kid", name: "Caspian Garcia", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.selectPendingSuggestions).toHaveBeenCalledWith({ limit: 200 });
    expect((await response.json()).items).toEqual([kidRow]);
  });
});

describe("GET /api/services/runtime — a revoked session reads no public runtime values", () => {
  it("401s a revoked session and never reads a service config", async () => {
    const response = await runtimeGET(
      request(
        "http://localhost/api/services/runtime",
        {},
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }, -60),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.getServiceConfig).not.toHaveBeenCalled();
  });

  it("403s a demoted parent and never reads a service config", async () => {
    roster["m-reb"].role = "child";

    const response = await runtimeGET(
      request(
        "http://localhost/api/services/runtime",
        {},
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.getServiceConfig).not.toHaveBeenCalled();
  });

  it("a live parent still reads the publicRuntime values", async () => {
    mocks.getServiceConfig.mockImplementation(async (service: string, key: string) =>
      service === "weather_location" && key === "LAT" ? "42.7875" : null,
    );

    const response = await runtimeGET(
      request(
        "http://localhost/api/services/runtime",
        {},
        await sessionCookie({ memberId: "m-reb", name: "Rebecca Garcia", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).runtime.weather_location).toEqual({ LAT: "42.7875" });
  });
});

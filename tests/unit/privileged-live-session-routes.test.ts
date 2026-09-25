import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

type LiveFailure = { ok: false; status: 401 | 403 | 503; error: string };
type LiveSuccess = {
  ok: true;
  identity: { memberId: string; name: string; role: "parent" | "child" | "pet" };
};
type LiveRosterRow = {
  id: string;
  name: string;
  role: string;
  age?: number;
  pin?: string;
  phone?: string;
};

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  requireLiveSession: vi.fn(),
  readSessionCookie: vi.fn(),
  verifyPinAgainstAnyMember: vi.fn(),
  verifyPinFromPB: vi.fn(),
  listMembersSanitized: vi.fn(),
  createMemberRecord: vi.fn(),
  findMemberByName: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  executeInternalTaskCommand: vi.fn(),
  getTool: vi.fn(),
  buildToolsForOpenAI: vi.fn(() => []),
  resolveChatTargets: vi.fn(),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContext: vi.fn(),
  insertChatMessage: vi.fn(),
  loadContextPack: vi.fn(),
  liveMembers: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  requireLiveSession: mocks.requireLiveSession,
  readSessionCookie: mocks.readSessionCookie,
  verifyPinAgainstAnyMember: mocks.verifyPinAgainstAnyMember,
  verifyPinFromPB: mocks.verifyPinFromPB,
  listMembersSanitized: mocks.listMembersSanitized,
  createMemberRecord: mocks.createMemberRecord,
  findMemberByName: mocks.findMemberByName,
  sanitizeMember: (member: any) => {
    const { pin, ...rest } = member ?? {};
    return rest;
  },
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
  verifyLiveParentSession: mocks.verifyLiveParentSession,
}));

vi.mock("@/lib/task-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/task-commands")>()),
  executeInternalTaskCommand: mocks.executeInternalTaskCommand,
}));

vi.mock("@/lib/hermes-tools", () => ({
  getTool: mocks.getTool,
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

vi.mock("@/lib/family-memory", () => ({
  buildMemoryContext: mocks.buildMemoryContext,
}));

vi.mock("@/db", () => ({
  db: { insertChatMessage: mocks.insertChatMessage },
}));

vi.mock("@/lib/consuela/assistant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/consuela/assistant-context")>()),
  loadContextPack: mocks.loadContextPack,
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveMembers: () => mocks.liveMembers(),
  parseJSON: (value: unknown, fallback: any) => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value ?? fallback;
  },
}));

import { POST as dbPOST } from "@/app/api/db/[collection]/route";
import { PATCH as dbPATCH, DELETE as dbDELETE } from "@/app/api/db/[collection]/[id]/route";
import { POST as syncPOST } from "@/app/api/tasks/sync/route";
import { GET as memberAdminGET, POST as memberAdminPOST } from "@/app/api/members/admin/route";
import { GET as whoamiGET } from "@/app/api/auth/whoami/route";
import { POST as plannerApplyPOST } from "@/app/api/consuela/planner/apply/route";
import { POST as managePOST } from "@/app/api/tasks/manage/route";
import { POST as claimPOST } from "@/app/api/tasks/claim/route";
import { POST as hermesPOST } from "@/app/api/hermes/chat/route";

const SESSION_ROLE_CHANGED: LiveFailure = {
  ok: false,
  status: 403,
  error: "session_role_changed",
};
const REVOKED: LiveFailure = { ok: false, status: 401, error: "unauthorized" };
const LIVE_PARENT: LiveSuccess = {
  ok: true,
  identity: { memberId: "m-parent", name: "Rebecca Garcia", role: "parent" },
};
const LIVE_CHILD: LiveSuccess = {
  ok: true,
  identity: { memberId: "m-kid", name: "Caspian Garcia", role: "child" },
};

const ROSTER: Record<string, LiveRosterRow> = {
  "m-parent": {
    id: "m-parent",
    name: "Rebecca Garcia",
    role: "parent",
    age: 40,
    pin: "9999",
    phone: "+15550000000",
  },
  "m-kid": { id: "m-kid", name: "Caspian Garcia", role: "child", age: 5, pin: "1111" },
};

let liveRoster: Record<string, LiveRosterRow> = {};

const pbWrites = {
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getFullList: vi.fn(),
};

function fakePb() {
  return {
    collection: (name: string) => ({
      getOne: async (id: string) => {
        if (name !== "members") return { id };
        const row = liveRoster[id];
        if (!row) throw { status: 404 };
        return { ...row };
      },
      create: async (row: any) => {
        pbWrites.create(name, row);
        return { id: "created-1", ...row };
      },
      update: async (id: string, row: any) => {
        pbWrites.update(name, id, row);
        return { id, ...row };
      },
      delete: async (id: string) => {
        pbWrites.delete(name, id);
        return {};
      },
      getFullList: async () => {
        pbWrites.getFullList(name);
        return [];
      },
    }),
  };
}

function jsonRequest(url: string, init: RequestInit = {}, cookie?: string): NextRequest {
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
  const token = await signSession(payload, ttlSeconds);
  return `${SESSION_COOKIE}=${token}`;
}

function collectionCtx(collection: string, id?: string) {
  return { params: Promise.resolve(id ? { collection, id } : { collection }) } as any;
}

function llmReply(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200 },
  );
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("ADMIN_SECRET", "admin-secret-test-value");
  vi.stubGlobal("fetch", vi.fn(async () => llmReply("{}")));
  liveRoster = structuredClone(ROSTER);
  for (const spy of Object.values(pbWrites)) spy.mockClear();
  mocks.withAdmin.mockReset().mockImplementation((fn: any) => fn(fakePb()));
  const actual = await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");
  mocks.requireLiveSession.mockReset().mockImplementation(actual.requireLiveSession);
  mocks.readSessionCookie.mockReset().mockImplementation(actual.readSessionCookie);
  mocks.verifyPinAgainstAnyMember.mockReset().mockResolvedValue(null);
  mocks.verifyPinFromPB.mockReset().mockResolvedValue(null);
  mocks.listMembersSanitized.mockReset().mockResolvedValue([
    { id: "m-parent", name: "Rebecca Garcia", role: "parent" },
    { id: "m-kid", name: "Caspian Garcia", role: "child" },
  ]);
  mocks.createMemberRecord.mockReset().mockResolvedValue(null);
  mocks.findMemberByName.mockReset().mockResolvedValue(null);
  mocks.getLiveMemberById.mockReset().mockImplementation(async (id: string) => {
    const row = liveRoster[id];
    return row ? ({ ...row } as any) : null;
  });
  mocks.getLiveMembers.mockReset().mockImplementation(async () =>
    Object.values(liveRoster).map((row) => ({ ...row })),
  );
  mocks.verifyLiveParentSession.mockReset().mockImplementation(async (request: NextRequest) => {
    const session = await import("@/lib/session");
    const signed = await session.verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!signed) return { ok: false, status: 401, reason: "unauthorized" };
    const member = await mocks.getLiveMemberById(signed.memberId);
    if (!member) return { ok: false, status: 401, reason: "member_missing" };
    if (member.role !== "parent") return { ok: false, status: 403, reason: "adult_only" };
    return { ok: true, member };
  });
  mocks.executeInternalTaskCommand.mockReset().mockResolvedValue({
    ok: true,
    operationId: "op-1",
    reconciled: true,
  });
  mocks.getTool.mockReset().mockReturnValue({ handler: vi.fn(async () => "{}") });
  mocks.buildToolsForOpenAI.mockClear();
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  mocks.resetAiTargetsForTests.mockReset();
  mocks.buildMemoryContext.mockReset().mockResolvedValue("");
  mocks.insertChatMessage.mockReset().mockResolvedValue({});
  mocks.loadContextPack.mockReset().mockResolvedValue({
    roster: [{ name: "Rebecca Garcia", role: "parent" }],
    today: {
      iso: "2026-09-14",
      weekday: "Mon",
      yesterdayIso: "2026-09-13",
      weekStartISO: "2026-09-07",
      tz: "America/Detroit",
    },
    unavailable: [],
  });
  mocks.liveMembers.mockReset().mockResolvedValue([{ id: "m-kid", name: "Caspian Garcia", role: "child" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("privileged routes revalidate the live role — a signed parent after PocketBase demotion", () => {
  it("generic POST /api/db/[collection] → 403 session_role_changed, no PB write", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/rewards",
        { method: "POST", body: JSON.stringify({ text: "movie night" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
      collectionCtx("rewards"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(pbWrites.create).not.toHaveBeenCalled();
  });

  it("PATCH /api/db/[collection]/[id] → 403 session_role_changed, no PB write", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await dbPATCH(
      jsonRequest(
        "http://localhost/api/db/rewards/row-1",
        { method: "PATCH", body: JSON.stringify({ text: "pizza night" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
      collectionCtx("rewards", "row-1"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(pbWrites.update).not.toHaveBeenCalled();
  });

  it("DELETE /api/db/[collection]/[id] → 403 session_role_changed, no PB write", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await dbDELETE(
      jsonRequest(
        "http://localhost/api/db/rewards/row-1",
        { method: "DELETE" },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
      collectionCtx("rewards", "row-1"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(pbWrites.delete).not.toHaveBeenCalled();
  });

  it("POST /api/tasks/sync → 403 session_role_changed, no snapshot read and no write", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await syncPOST(
      jsonRequest(
        "http://localhost/api/tasks/sync",
        { method: "POST", body: JSON.stringify({ tasks: [] }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "session_role_changed" });
    expect(pbWrites.getFullList).not.toHaveBeenCalled();
    expect(pbWrites.create).not.toHaveBeenCalled();
  });

  it("GET /api/members/admin → 403 session_role_changed, roster never listed", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await memberAdminGET(
      jsonRequest(
        "http://localhost/api/members/admin",
        {},
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.listMembersSanitized).not.toHaveBeenCalled();
  });

  it("POST /api/consuela/planner/apply → 403 session_role_changed before the PIN is read", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await plannerApplyPOST(
      jsonRequest(
        "http://localhost/api/consuela/planner/apply",
        {
          method: "POST",
          headers: { "x-consuela-pin": "9999" },
          body: JSON.stringify({ tool: "add_event", args: { title: "Soccer", date: "2026-09-11" } }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
    expect(mocks.getTool).not.toHaveBeenCalled();
  });

  it("POST /api/hermes/chat planner → 401 unauthorized, the provider is never called", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await hermesPOST(
      jsonRequest(
        "http://localhost/api/hermes/chat",
        { method: "POST", body: JSON.stringify({ agent: "planner", intent: "meal_week" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("POST /api/tasks/manage → 403 adult_only, the command seam is never entered", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await managePOST(
      jsonRequest(
        "http://localhost/api/tasks/manage",
        {
          method: "POST",
          body: JSON.stringify({ operationId: "op-manage-1", action: "delete", taskId: 77 }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("POST /api/tasks/claim PIN-free → 403 session_role_changed, the command seam is never entered", async () => {
    liveRoster["m-parent"].role = "child";

    const response = await claimPOST(
      jsonRequest(
        "http://localhost/api/tasks/claim",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: "op-claim-1",
            action: "complete",
            taskId: 42,
            memberName: "Rebecca Garcia",
          }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, reason: "session_role_changed" });
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });
});

describe("a revoked or deleted identity is refused before any write", () => {
  it("generic POST /api/db/[collection] with an expired session → 401 unauthorized", async () => {
    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/rewards",
        { method: "POST", body: JSON.stringify({ text: "movie night" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }, -60),
      ),
      collectionCtx("rewards"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(pbWrites.create).not.toHaveBeenCalled();
  });

  it("generic POST /api/db/[collection] after the member row is deleted → 401 unauthorized", async () => {
    delete liveRoster["m-parent"];

    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/rewards",
        { method: "POST", body: JSON.stringify({ text: "movie night" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
      collectionCtx("rewards"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(pbWrites.create).not.toHaveBeenCalled();
  });

  it("POST /api/tasks/claim PIN-free after the member row is deleted → 401 unauthorized", async () => {
    delete liveRoster["m-kid"];

    const response = await claimPOST(
      jsonRequest(
        "http://localhost/api/tasks/claim",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: "op-claim-2",
            action: "complete",
            taskId: 42,
            memberName: "Caspian Garcia",
          }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, reason: "unauthorized" });
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("GET /api/auth/whoami after the member row is deleted → 401 unauthorized", async () => {
    delete liveRoster["m-parent"];

    const response = await whoamiGET(
      jsonRequest(
        "http://localhost/api/auth/whoami",
        {},
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("positive paths stay open for a live identity", () => {
  it("live parent POST /api/db/[collection] on a parent collection writes", async () => {
    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/rewards",
        { method: "POST", body: JSON.stringify({ text: "movie night" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
      collectionCtx("rewards"),
    );

    expect(response.status).toBe(200);
    expect(pbWrites.create).toHaveBeenCalledTimes(1);
  });

  it("live parent PATCH and DELETE /api/db/[collection]/[id] write", async () => {
    const cookie = await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" });
    const patch = await dbPATCH(
      jsonRequest(
        "http://localhost/api/db/rewards/row-1",
        { method: "PATCH", body: JSON.stringify({ text: "pizza night" }) },
        cookie,
      ),
      collectionCtx("rewards", "row-1"),
    );
    const remove = await dbDELETE(
      jsonRequest("http://localhost/api/db/rewards/row-1", { method: "DELETE" }, cookie),
      collectionCtx("rewards", "row-1"),
    );

    expect(patch.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(pbWrites.update).toHaveBeenCalledTimes(1);
    expect(pbWrites.delete).toHaveBeenCalledTimes(1);
  });

  it("live child POST /api/db/[collection] on a shared household collection writes", async () => {
    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/pantry_items",
        { method: "POST", body: JSON.stringify({ name: "Rice" }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
      collectionCtx("pantry_items"),
    );

    expect(response.status).toBe(200);
    expect(pbWrites.create).toHaveBeenCalledTimes(1);
  });

  it("live parent POST /api/db/[collection] on a command-owned collection is 403 command_only with no PocketBase write", async () => {
    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/tasks",
        { method: "POST", body: JSON.stringify({ title: "Dishes" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
      collectionCtx("tasks"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "command_only" });
    expect(pbWrites.create).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("live child on a parent collection is still 403 adult_only", async () => {
    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/emergency_contacts",
        { method: "POST", body: JSON.stringify({ name: "Neighbor" }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
      collectionCtx("emergency_contacts"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "adult_only" });
    expect(pbWrites.create).not.toHaveBeenCalled();
  });

  it("live child GET /api/members/admin lists the sanitized roster", async () => {
    const response = await memberAdminGET(
      jsonRequest(
        "http://localhost/api/members/admin",
        {},
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).members).toHaveLength(2);
  });

  it("GET /api/auth/whoami resolves by the signed memberId and returns only the live identity", async () => {
    liveRoster["m-parent"].name = "Rebecca Renamed";

    const response = await whoamiGET(
      jsonRequest(
        "http://localhost/api/auth/whoami",
        {},
        await sessionCookie({ memberId: "m-parent", name: "Rebecca Signed", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.member).toEqual({
      memberId: "m-parent",
      name: "Rebecca Renamed",
      role: "parent",
    });
    expect(JSON.stringify(body)).not.toContain("9999");
    expect(JSON.stringify(body)).not.toContain("+15550000000");
  });

  it("POST /api/tasks/sync with a live child session still refuses browser writes", async () => {
    const response = await syncPOST(
      jsonRequest(
        "http://localhost/api/tasks/sync",
        { method: "POST", body: JSON.stringify({ tasks: [] }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ ok: false, error: "legacy_sync_write_disabled" });
  });

  it("POST /api/consuela/planner/apply: live parent session plus a parent PIN applies", async () => {
    mocks.verifyPinAgainstAnyMember.mockResolvedValue({
      id: "m-parent",
      name: "Rebecca Garcia",
      role: "parent",
    });
    mocks.getTool.mockReturnValue({
      handler: vi.fn(async () => JSON.stringify({ ok: true, event: { id: "e1" } })),
    });

    const response = await plannerApplyPOST(
      jsonRequest(
        "http://localhost/api/consuela/planner/apply",
        {
          method: "POST",
          headers: { "x-consuela-pin": "9999" },
          body: JSON.stringify({ tool: "add_event", args: { title: "Soccer", date: "2026-09-11" } }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.verifyPinAgainstAnyMember).toHaveBeenCalledWith("9999");
  });

  it("POST /api/tasks/manage with a live parent session reaches the command seam as the live actor", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-manage-2",
      reconciled: true,
      task: { taskId: 77 },
      revision: { revision: "5", updatedAt: "2026-09-24T10:00:00.000Z" },
    });

    const response = await managePOST(
      jsonRequest(
        "http://localhost/api/tasks/manage",
        {
          method: "POST",
          body: JSON.stringify({ operationId: "op-manage-2", action: "delete", taskId: 77 }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.executeInternalTaskCommand.mock.calls[0][0].actor).toMatchObject({
      memberId: "m-parent",
      role: "parent",
    });
  });

  it("POST /api/tasks/claim PIN-free: the live child session is the actor, resolved by memberId", async () => {
    const response = await claimPOST(
      jsonRequest(
        "http://localhost/api/tasks/claim",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: "op-claim-3",
            action: "complete",
            taskId: 42,
            memberName: "Caspian Garcia",
          }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    const command = mocks.executeInternalTaskCommand.mock.calls[0][0];
    expect(command.kind).toBe("complete");
    expect(command.actor).toMatchObject({
      memberId: "m-kid",
      name: "Caspian Garcia",
      role: "child",
      authentication: "session",
    });
  });

  it("POST /api/members/admin with the server ADMIN_SECRET never consults the session", async () => {
    mocks.createMemberRecord.mockResolvedValue({
      id: "m-new",
      name: "Nova Garcia",
      role: "child",
      emoji: "🦄",
      pin: "4242",
    });

    const response = await memberAdminPOST(
      jsonRequest("http://localhost/api/members/admin", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret-test-value" },
        body: JSON.stringify({ name: "Nova Garcia", role: "child" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMemberRecord).toHaveBeenCalledTimes(1);
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("4242");
  });

  it("POST /api/hermes/chat with no cookie keeps the guest/child surface untouched", async () => {
    const response = await hermesPOST(
      jsonRequest("http://localhost/api/hermes/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
  });

  it("POST /api/hermes/chat with a revoked session is refused, never downgraded to a guest", async () => {
    const response = await hermesPOST(
      jsonRequest(
        "http://localhost/api/hermes/chat",
        { method: "POST", body: JSON.stringify({ message: "hi" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }, -60),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("POST /api/hermes/chat with a live child session keeps the kid surface", async () => {
    const response = await hermesPOST(
      jsonRequest(
        "http://localhost/api/hermes/chat",
        { method: "POST", body: JSON.stringify({ message: "hi" }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
  });
});

describe("every gate consumes the shared live-session contract", () => {
  it("generic writes and the roster map a refused session verbatim; the handlers add no PocketBase access of their own", async () => {
    mocks.requireLiveSession.mockResolvedValue(SESSION_ROLE_CHANGED);

    const cookie = await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" });
    const post = await dbPOST(
      jsonRequest("http://localhost/api/db/rewards", { method: "POST", body: "{}" }, cookie),
      collectionCtx("rewards"),
    );
    const patch = await dbPATCH(
      jsonRequest("http://localhost/api/db/rewards/row-1", { method: "PATCH", body: "{}" }, cookie),
      collectionCtx("rewards", "row-1"),
    );
    const remove = await dbDELETE(
      jsonRequest("http://localhost/api/db/rewards/row-1", { method: "DELETE" }, cookie),
      collectionCtx("rewards", "row-1"),
    );
    const sync = await syncPOST(
      jsonRequest("http://localhost/api/tasks/sync", { method: "POST", body: "{}" }, cookie),
    );
    const roster = await memberAdminGET(
      jsonRequest("http://localhost/api/members/admin", {}, cookie),
    );
    const whoami = await whoamiGET(
      jsonRequest("http://localhost/api/auth/whoami", {}, cookie),
    );

    expect([post.status, patch.status, remove.status, sync.status, roster.status, whoami.status]).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);
    expect(await post.json()).toEqual({ error: "session_role_changed" });
    expect(await patch.json()).toEqual({ error: "session_role_changed" });
    expect(await remove.json()).toEqual({ error: "session_role_changed" });
    expect(await sync.json()).toEqual({ ok: false, error: "session_role_changed" });
    expect(await roster.json()).toEqual({ error: "session_role_changed" });
    expect(await whoami.json()).toEqual({ error: "session_role_changed" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(mocks.listMembersSanitized).not.toHaveBeenCalled();
  });

  it("a revoked session is reported as 401 unauthorized by every handler", async () => {
    mocks.requireLiveSession.mockResolvedValue(REVOKED);

    const cookie = await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" });
    const post = await dbPOST(
      jsonRequest("http://localhost/api/db/rewards", { method: "POST", body: "{}" }, cookie),
      collectionCtx("rewards"),
    );
    const sync = await syncPOST(
      jsonRequest("http://localhost/api/tasks/sync", { method: "POST", body: "{}" }, cookie),
    );
    const roster = await memberAdminGET(
      jsonRequest("http://localhost/api/members/admin", {}, cookie),
    );

    expect([post.status, sync.status, roster.status]).toEqual([401, 401, 401]);
    expect(await post.json()).toEqual({ error: "unauthorized" });
    expect(await sync.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(await roster.json()).toEqual({ error: "unauthorized" });
  });

  it("generic writes ask for no role so the per-collection policy reads the live role", async () => {
    mocks.requireLiveSession.mockResolvedValue(LIVE_CHILD);

    await dbPOST(
      jsonRequest(
        "http://localhost/api/db/pantry_items",
        { method: "POST", body: JSON.stringify({ name: "Rice" }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
      collectionCtx("pantry_items"),
    );

    expect(mocks.requireLiveSession.mock.calls[0][1]).toBeUndefined();
  });

  it("a command-owned collection is refused without resolving an identity at all", async () => {
    mocks.requireLiveSession.mockResolvedValue(LIVE_PARENT);

    const response = await dbPOST(
      jsonRequest(
        "http://localhost/api/db/week_data",
        { method: "POST", body: JSON.stringify({ weekStart: "2026-09-21", points: { Alex: 9999 } }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
      collectionCtx("week_data"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "command_only" });
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("member admin GET accepts any live identity and never asks for a role", async () => {
    mocks.requireLiveSession.mockResolvedValue(LIVE_CHILD);

    const response = await memberAdminGET(
      jsonRequest(
        "http://localhost/api/members/admin",
        {},
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireLiveSession.mock.calls[0][1]).toBeUndefined();
  });

  it("planner apply asks for a live parent before it reads the PIN", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });

    const response = await plannerApplyPOST(
      jsonRequest(
        "http://localhost/api/consuela/planner/apply",
        {
          method: "POST",
          headers: { "x-consuela-pin": "9999" },
          body: JSON.stringify({ tool: "add_event", args: { title: "Soccer", date: "2026-09-11" } }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "adult_only" });
    expect(mocks.requireLiveSession.mock.calls[0][1]).toEqual({ requireRole: "parent" });
    expect(mocks.verifyPinAgainstAnyMember).not.toHaveBeenCalled();
  });

  it("planner apply still demands the PIN once the live parent session is proven", async () => {
    mocks.requireLiveSession.mockResolvedValue(LIVE_PARENT);

    const response = await plannerApplyPOST(
      jsonRequest(
        "http://localhost/api/consuela/planner/apply",
        {
          method: "POST",
          body: JSON.stringify({ tool: "add_event", args: { title: "Soccer", date: "2026-09-11" } }),
        },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "pin required" });
  });

  it("the hermes planner asks for a live parent and maps any refusal to unauthorized", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });

    const response = await hermesPOST(
      jsonRequest(
        "http://localhost/api/hermes/chat",
        { method: "POST", body: JSON.stringify({ agent: "planner", intent: "meal_week" }) },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(mocks.requireLiveSession.mock.calls[0][1]).toEqual({ requireRole: "parent" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("the regular hermes chat asks for no role and a live parent keeps the adult surface", async () => {
    mocks.requireLiveSession.mockResolvedValue(LIVE_PARENT);

    const response = await hermesPOST(
      jsonRequest(
        "http://localhost/api/hermes/chat",
        { method: "POST", body: JSON.stringify({ message: "turn on the lights" }) },
        await sessionCookie({ memberId: "m-parent", name: "Rebecca", role: "parent" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireLiveSession.mock.calls[0][1]).toBeUndefined();
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: true, role: "parent" });
  });

  it("task manage refuses a signed child session without entering the command seam", async () => {
    const response = await managePOST(
      jsonRequest(
        "http://localhost/api/tasks/manage",
        {
          method: "POST",
          body: JSON.stringify({ operationId: "op-manage-3", action: "delete", taskId: 77 }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("the PIN-free claim path never consults the PIN verifier", async () => {
    const response = await claimPOST(
      jsonRequest(
        "http://localhost/api/tasks/claim",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: "op-claim-4",
            action: "complete",
            taskId: 42,
            memberName: "Caspian Garcia",
          }),
        },
        await sessionCookie({ memberId: "m-kid", name: "Caspian", role: "child" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyPinFromPB).not.toHaveBeenCalled();
  });

  it("the PIN-only path is untouched by the live session gate", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "m-kid", name: "Caspian Garcia", role: "child", age: 5 });

    const response = await claimPOST(
      jsonRequest("http://localhost/api/tasks/claim", {
        method: "POST",
        body: JSON.stringify({
          operationId: "op-claim-5",
          action: "complete",
          taskId: 42,
          memberName: "Caspian Garcia",
          pin: "1111",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyPinFromPB).toHaveBeenCalledWith("Caspian Garcia", "1111");
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
  });
});

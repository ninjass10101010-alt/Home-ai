// C — /api/hermes/chat trusts the LIVE PocketBase role, never the cookie's.
//
// The cookie role is a 7-day claim with no revocation: a parent demoted to
// child (or removed) kept the full parent tool surface — `trigger_update`,
// `restart_container` and friends — for the life of the cookie. AGENTS.md is
// explicit: a cookie role is never trusted, a privileged decision re-reads the
// live PocketBase identity and parent role, and a PocketBase outage fails
// closed.
//
// Sibling idiom (consistency with the existing security model, not novelty):
//   * any-role conversational gate → `authorizeCurrentMemberRequest`
//     (src/lib/server-auth.ts) — the same helper the db-gateway routes use. It
//     re-reads the live row and hands back the LIVE role, so a drift degrades
//     the turn to the kid surface instead of locking the member out of chat.
//   * parent-only planner → `requireLiveSession({requireRole:"parent"})`,
//     byte-for-byte the gate /api/consuela/planner/apply uses.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  insertChatMessage: vi.fn(async () => ({})),
  buildToolsForOpenAI: vi.fn(() => [] as any[]),
  getTool: vi.fn(() => undefined),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
  recordChatOutcome: vi.fn(),
  buildMemoryContext: vi.fn(async () => ""),
  loadContextPack: vi.fn(async () => ({})),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));
vi.mock("@/lib/ai/health", () => ({ recordChatOutcome: mocks.recordChatOutcome }));
vi.mock("@/lib/family-memory", () => ({ buildMemoryContext: mocks.buildMemoryContext }));
vi.mock("@/lib/consuela/assistant-context", () => ({
  loadContextPack: mocks.loadContextPack,
  composeContextPrompt: () => "",
}));
vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));
vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const PARENT = { id: "m1", name: "Rebecca", role: "parent" };
const DEMOTED = { id: "m1", name: "Rebecca", role: "child" };

// The four parent-only tools. A child must never reach any of them, and
// neither must a cookie that claims `parent` over a live row that says otherwise.
const PARENT_ONLY_TOOLS = [
  "trigger_update",
  "restart_container",
  "check_for_update",
  "get_container_status",
];

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
      }),
    });
  });
}

async function cookieFor(memberId: string, name: string, role: string) {
  return `${SESSION_COOKIE}=${await signSession({ memberId, name, role })}`;
}

function post(body: Record<string, unknown>, cookie?: string) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  );
}

function bufferedReply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The tool NAMES the route actually armed on the last buildToolsForOpenAI call. */
function toolNameSet(): Set<string> {
  const results = mocks.buildToolsForOpenAI.mock.results;
  const tools = (results.length ? results[results.length - 1].value : []) as any[];
  return new Set(tools.map((t: any) => t.function.name));
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  resetAiChatForTests();
  serveLiveRows([PARENT]);
  mocks.resolveChatTargets.mockReset().mockResolvedValue([
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  mocks.insertChatMessage.mockClear();
  mocks.recordChatOutcome.mockClear();
  mocks.loadContextPack.mockClear().mockResolvedValue({});
  mocks.buildMemoryContext.mockClear().mockResolvedValue("");
  mocks.getTool.mockReset().mockReturnValue(undefined);
  // Role-scoped tool manifest: `houseControl` is the parent-only switch the
  // route derives, and `role` is the normalized actor role.
  mocks.buildToolsForOpenAI.mockReset().mockImplementation(
    (opts?: { houseControl?: boolean; role?: string }) => {
      const { houseControl } = opts || {};
      return (houseControl ? PARENT_ONLY_TOOLS : ["get_grocery_list", "get_pantry"]).map((name) => ({
        function: { name, description: "", parameters: { type: "object", properties: {} } },
      })) as any[];
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("C — the parent tool surface follows the LIVE role", () => {
  it("a cookie claiming parent over a live child row gets the KID surface", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Milk and eggs.")));
    const res = await post(
      { message: "update the dashboard", stream: true },
      await cookieFor(DEMOTED.id, DEMOTED.name, "parent"),
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
  });

  it("a demoted parent's cookie reaches none of the four parent-only tools", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Milk and eggs.")));
    await post({ message: "restart the container", stream: true }, await cookieFor(DEMOTED.id, DEMOTED.name, "parent"));
    const offered = toolNameSet();
    for (const name of PARENT_ONLY_TOOLS) expect(offered.has(name)).toBe(false);
  });

  it("a demoted parent's cookie never receives the house-control prompt addendum", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Milk and eggs.")));
    await post({ message: "turn on the lights", stream: true }, await cookieFor(DEMOTED.id, DEMOTED.name, "parent"));
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.messages[0].content).not.toContain("House control");
  });

  it("a genuine live parent still gets the full parent surface (no over-tightening)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Done.")));
    await post({ message: "update the dashboard", stream: true }, await cookieFor(PARENT.id, PARENT.name, "parent"));
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: true, role: "parent" });
    const offered = toolNameSet();
    for (const name of PARENT_ONLY_TOOLS) expect(offered.has(name)).toBe(true);
  });

  it("a demoted parent's turn is attributed to the LIVE member, and memory context is withheld", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Milk and eggs.")));
    await post({ message: "what are we low on?", stream: true }, await cookieFor(DEMOTED.id, DEMOTED.name, "parent"));
    await new Promise((r) => setTimeout(r, 0));
    const rows = mocks.insertChatMessage.mock.calls.map((c: any[]) => c[0]);
    const userRow = rows.find((r: any) => r.role === "user");
    // Attribution follows the live row's name, never the cookie's claim.
    expect(userRow.userId).toBe(DEMOTED.name);
    expect(mocks.buildMemoryContext).not.toHaveBeenCalled();
  });
});

describe("C — the planner requires a LIVE parent session", () => {
  it("refuses a cookie claiming parent over a live child row", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("{}")));
    const res = await post(
      { agent: "planner", intent: "meal_ideas" },
      await cookieFor(DEMOTED.id, DEMOTED.name, "parent"),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses a cookie claiming parent whose live row is gone", async () => {
    serveLiveRows([]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("{}")));
    const res = await post({ agent: "planner", intent: "meal_ideas" }, await cookieFor("m1", "Rebecca", "parent"));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
  });

  it("fails CLOSED when PocketBase cannot answer (503 identity_unavailable)", async () => {
    serveLiveRows([], { outage: true });
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("{}")));
    const res = await post({ agent: "planner", intent: "meal_ideas" }, await cookieFor("m1", "Rebecca", "parent"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("identity_unavailable");
  });

  it("still answers a genuine live parent (no_provider/valid-JSON contract intact)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => bufferedReply('{"actions":[{"type":"meal","title":"Tacos","detail":"30 min"}]}')),
    );
    const res = await post({ agent: "planner", intent: "meal_ideas" }, await cookieFor(PARENT.id, PARENT.name, "parent"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.actions[0].title).toBe("Tacos");
  });

  it("keeps the client's {ok:false, reason} failure shape (UI error copy depends on it)", async () => {
    serveLiveRows([DEMOTED]);
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("{}")));
    const res = await post(
      { agent: "planner", intent: "meal_ideas" },
      await cookieFor(DEMOTED.id, DEMOTED.name, "parent"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("answers a session-less planner call 401 with the same shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("{}")));
    const res = await post({ agent: "planner", intent: "meal_ideas" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthorized" });
  });
});

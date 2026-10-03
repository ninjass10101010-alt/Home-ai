// /api/hermes/chat — the WRITE gate and the persistence intent (A + B).
//
// Two defects, one seam:
//
//   A. `persistChatPair` fired on `!isClem` — inferred from the ABSENCE of an
//      `agent` field. Both recipe-parse callers (useRecipes.ts:188 in the
//      browser, api/recipes/ingest/route.ts:163 server-side) post a bare
//      `{message}`, so `!isClem` was true and the ~3000-char parse prompt plus
//      the raw JSON landed in the family's shared `chat_messages` as chat
//      bubbles on every device. Persistence must be a POSITIVE declaration of
//      a family-thread turn, not a consequence of a field being missing.
//
//   B. `/api/hermes/` sits on the middleware API_EXEMPT list, and the only
//      route under it is this one — the family thread's only writer. An
//      unauthenticated caller reached the whole kid read surface AND could
//      write attacker-controlled text into the shared thread as "guest".
//      The writer path now requires a verified LIVE identity; the read
//      behaviour the exemption exists for (the internal, non-conversational
//      recipe parse) is preserved and stays tool-free.
//
// Harness: mock the seams, keep `@/lib/session` + `@/lib/server-auth` real so
// the gate is exercised end to end against a fake PocketBase members row.
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
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/db", () => ({ db: { insertChatMessage: mocks.insertChatMessage } }));
vi.mock("@/lib/ai/health", () => ({ recordChatOutcome: mocks.recordChatOutcome }));
vi.mock("@/lib/family-memory", () => ({ buildMemoryContext: mocks.buildMemoryContext }));
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
const CHILD = { id: "m2", name: "Emily", role: "child" };

/** Serve the live members collection the session helpers read through withAdmin. */
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

async function parentCookie() {
  return `${SESSION_COOKIE}=${await signSession({ memberId: PARENT.id, name: PARENT.name, role: PARENT.role })}`;
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

function sseReply(content: string) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** The exact body api/recipes/ingest/route.ts and useRecipes.ts post. */
const PARSE_BODY = {
  message: [
    "You are Consuela, an expert recipe parser.",
    "Parse the provided content into a single recipe.",
    "--- Content ---",
    "Grandma's lasagna, 12 layers, 450F, 45 minutes",
  ].join("\n"),
};

function providerPayload(call = 0): any {
  return JSON.parse((globalThis.fetch as any).mock.calls[call][1].body);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  resetAiChatForTests();
  serveLiveRows([PARENT, CHILD]);
  mocks.resolveChatTargets.mockReset().mockResolvedValue([
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  mocks.insertChatMessage.mockClear();
  mocks.recordChatOutcome.mockClear();
  mocks.buildMemoryContext.mockClear().mockResolvedValue("");
  mocks.getTool.mockReset().mockReturnValue(undefined);
  mocks.buildToolsForOpenAI.mockReset().mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("A — persistence is a positive thread-turn intent", () => {
  it("a non-conversational parse call writes NOTHING into the family thread", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply('{"type":"recipe","title":"Lasagna"}')));
    const res = await post(PARSE_BODY);
    expect(res.status).toBe(200);
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("a parse call from a SIGNED-IN parent still writes nothing (browser importer)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply('{"type":"recipe","title":"Lasagna"}')));
    const res = await post(PARSE_BODY, await parentCookie());
    expect(res.status).toBe(200);
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("a parse call is never given the family's tools — it cannot read or write family data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply('{"type":"recipe","title":"Lasagna"}')));
    await post(PARSE_BODY);
    const payload = providerPayload();
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it("a streamed family-thread turn still persists exactly the user + assistant pair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("Groceries are low on milk.")));
    const res = await post({ message: "what are we low on?", stream: true }, await parentCookie());
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    expect(mocks.insertChatMessage).toHaveBeenCalledTimes(2);
    const rows = mocks.insertChatMessage.mock.calls.map((c: any[]) => c[0]);
    expect(rows.find((r: any) => r.role === "user").userId).toBe(PARENT.name);
    expect(rows.find((r: any) => r.role === "assistant").userId).toBe("consuela");
  });

  it("a streamed Clem turn persists nothing (the sheet is not the family thread)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("Pasta and sauce.")));
    const res = await post({ message: "what's for dinner?", agent: "clem", stream: true }, await parentCookie());
    await res.text();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });
});

describe("B — the writer path requires a verified live identity", () => {
  it("never writes an anonymous turn into the family thread (there is no 'guest' writer)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("Milk and eggs.")));
    const res = await post({ message: "hi", stream: true });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("never writes an anonymous BUFFERED turn either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply("Milk and eggs.")));
    const res = await post({ message: "hi", agent: "clem" });
    expect(res.status).toBe(200);
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("arms NO tools for an anonymous conversation — the exempted read stays a completion", async () => {
    // DESIGN.md: "signed-out chat says so (amber banner) — guest AI still
    // answers". That read behaviour is preserved; what is gone is the family's
    // 20-tool read surface and every write tool behind it.
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("Milk and eggs.")));
    await (await post({ message: "what's on the grocery list?", stream: true })).text();
    expect(mocks.buildToolsForOpenAI).not.toHaveBeenCalled();
    const payload = providerPayload();
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it("still answers the internal parse caller — the read role the exemption exists for", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bufferedReply('{"type":"recipe","title":"Lasagna"}')));
    const res = await post(PARSE_BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).content).toContain("Lasagna");
  });

  it("a cookie whose live member is gone loses the tools and the store", async () => {
    serveLiveRows([]);
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("Milk and eggs.")));
    const res = await post({ message: "hi", stream: true }, await parentCookie());
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.text();
    expect(mocks.buildToolsForOpenAI).not.toHaveBeenCalled();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("fails CLOSED when PocketBase cannot answer the identity read (503, never a write)", async () => {
    serveLiveRows([], { outage: true });
    vi.stubGlobal("fetch", vi.fn(async () => sseReply("should never be reached")));
    const res = await post({ message: "hi", stream: true }, await parentCookie());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "identity_unavailable" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });
});

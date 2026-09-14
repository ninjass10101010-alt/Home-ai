import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { ContextPack } from "@/lib/consuela/assistant-context";

// Harness copied wholesale from tests/unit/hermes-chat-clem.test.ts — the
// proven mock idiom for this route (targets resolver, fetch stub, db seam).
const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContext: vi.fn(async () => ""),
  loadContextPack: vi.fn(async (): Promise<ContextPack> => ({
    roster: [{ name: "Rebecca", role: "parent" }],
    today: { iso: "2026-09-14", weekday: "Mon", yesterdayIso: "2026-09-13", weekStartISO: "2026-09-07", tz: "America/Detroit" },
    unavailable: [],
  })),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

vi.mock("@/lib/family-memory", () => ({
  buildMemoryContext: mocks.buildMemoryContext,
}));

// The pack's REAL composer stays live (plannerSystemPrompt is exercised
// end-to-end); only the impure zone reads are replaced.
vi.mock("@/lib/consuela/assistant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/consuela/assistant-context")>()),
  loadContextPack: mocks.loadContextPack,
}));

vi.mock("@/db", () => ({
  db: { insertChatMessage: mocks.insertChatMessage },
}));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";

function llmReply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

async function post(body: Record<string, unknown>, cookie?: string) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

async function parentCookie() {
  const { signSession, SESSION_COOKIE } = await import("@/lib/session");
  process.env.SESSION_SECRET = "test-secret-0123456789";
  const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
  return `${SESSION_COOKIE}=${token}`;
}

async function childCookie() {
  const { signSession, SESSION_COOKIE } = await import("@/lib/session");
  process.env.SESSION_SECRET = "test-secret-0123456789";
  const token = await signSession({ memberId: "m2", name: "Emily", role: "child" });
  return `${SESSION_COOKIE}=${token}`;
}

function sentBodies(): any[] {
  return (globalThis.fetch as any).mock.calls.map((c: any[]) => JSON.parse(c[1].body));
}

beforeEach(() => {
  resetAiChatForTests();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubGlobal("fetch", vi.fn(async () => llmReply("{}")));
  mocks.buildToolsForOpenAI.mockClear();
  mocks.getTool.mockClear();
  mocks.insertChatMessage.mockClear();
  mocks.buildMemoryContext.mockClear();
  mocks.loadContextPack.mockClear();
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const VALID_MEAL_WEEK = JSON.stringify({
  meal_plan: [{ day: "Mon", mealType: "dinner", name: "Tacos", emoji: "🌮", tags: ["Kid-friendly"], prepTime: "20 min" }],
});

describe("hermes chat — planner agent", () => {
  it("planner: adult session succeeds, no tools sent, nothing persisted", async () => {
    (globalThis.fetch as any).mockImplementation(async () => llmReply(VALID_MEAL_WEEK));
    const res = await post({ agent: "planner", intent: "meal_week", options: { weekOf: "2026-09-07", days: ["Mon", "Tue"] } }, await parentCookie());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.intent).toBe("meal_week");
    expect(json.result.meal_plan[0].name).toBe("Tacos");

    const sent = sentBodies()[0];
    // ZERO tools armed — and tool_choice is dropped with them (some providers
    // 400 on tool_choice without tools).
    expect("tools" in sent).toBe(false);
    expect("tool_choice" in sent).toBe(false);
    expect(sent.max_tokens).toBe(4096);
    // The tool surface is never even built for a planner call.
    expect(mocks.buildToolsForOpenAI).not.toHaveBeenCalled();
    expect(mocks.getTool).not.toHaveBeenCalled();
    // No thread pollution.
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
    // Grounded prompt: context pack in system, weekOf + days in the user turn.
    expect(sent.messages[0].content).toContain("Consuela live context pack");
    expect(sent.messages[0].content).toContain("meal_plan");
    expect(sent.messages[1].content).toContain("2026-09-07");
    expect(sent.messages[1].content).toContain("Mon, Tue");
  });

  it("planner: child session → 401, provider never called", async () => {
    const res = await post({ agent: "planner", intent: "meal_week" }, await childCookie());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("planner: guest → 401", async () => {
    const res = await post({ agent: "planner", intent: "meal_week" });
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("unauthorized");
  });

  it("planner: unknown intent → 400, provider never called", async () => {
    const res = await post({ agent: "planner", intent: "grocery_week" }, await parentCookie());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "unknown_intent" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("planner: invalid output gets ONE repair retry then honest failure", async () => {
    (globalThis.fetch as any).mockImplementation(async () => llmReply("Sure! I would suggest some lovely dinners:"));
    const res = await post({ agent: "planner", intent: "meal_week" }, await parentCookie());
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: "invalid_model_output" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const bodies = sentBodies();
    // The retry carries the bad assistant turn + the JSON-only repair demand.
    expect(bodies[0].messages.length).toBe(2);
    expect(bodies[1].messages[2]).toMatchObject({ role: "assistant" });
    expect(bodies[1].messages[3].role).toBe("user");
    expect(bodies[1].messages[3].content).toContain("ONLY valid JSON");
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("planner: provider throw fails over to the next target without burning the repair", async () => {
    mocks.resolveChatTargets.mockImplementation(async () => [
      { url: "http://dead.local", key: "k", model: "dead", provider: "p", fallback: false },
      { url: "http://brain.local", key: "k", model: "brain", provider: "p", fallback: true },
    ]);
    let calls = 0;
    (globalThis.fetch as any).mockImplementation(async (url: string) => {
      calls += 1;
      if (String(url).includes("dead.local")) throw new Error("ECONNREFUSED");
      return llmReply('{"actions":[{"type":"task","title":"Vacuum","points":10}]}');
    });
    const res = await post({ agent: "planner", intent: "task_ideas" }, await parentCookie());
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.actions[0].title).toBe("Vacuum");
    expect(calls).toBe(2);
    expect(sentBodies()[1].max_tokens).toBe(1536);
  });

  it("planner: all providers dead → honest provider_unavailable", async () => {
    (globalThis.fetch as any).mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await post({ agent: "planner", intent: "schedule_week" }, await parentCookie());
    expect(await res.json()).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("planner dispatches before the chat pipeline: no message field needed, buildChatContext untouched", async () => {
    (globalThis.fetch as any).mockImplementation(async () => llmReply(VALID_MEAL_WEEK));
    const res = await post({ agent: "planner", intent: "meal_week" }, await parentCookie());
    // A chat-shaped empty-message 400 would mean the planner dispatch landed
    // after the chat guards — it must come before buildChatContext entirely.
    expect(res.status).toBe(200);
    expect(mocks.buildMemoryContext).not.toHaveBeenCalled();
  });
});

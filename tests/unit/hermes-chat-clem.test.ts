import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContext: vi.fn(async () => ""),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

// F4 — the route pulls memory-bank context into adult prompts; pin the seam
// so the fetch mock isn't consumed by a real PocketBase read.
vi.mock("@/lib/family-memory", () => ({
  buildMemoryContext: mocks.buildMemoryContext,
}));

vi.mock("@/db", () => ({
  db: { insertChatMessage: mocks.insertChatMessage },
}));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";

function hermesReply(content = "ok") {
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

beforeEach(() => {
  resetAiChatForTests();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
  mocks.buildToolsForOpenAI.mockClear();
  mocks.getTool.mockClear();
  mocks.insertChatMessage.mockClear();
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  // Default tools: include both clem and non-clem to verify filtering
  mocks.buildToolsForOpenAI.mockImplementation(() => [
    { type: "function", function: { name: "get_grocery_list", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "get_pantry", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "add_grocery_item", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "complete_grocery_item", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "get_weekly_meals", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "get_recipes", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "compare_grocery_prices", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "check_for_update", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "ha_control_device", description: "", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "get_proactive_suggestions", description: "", parameters: { type: "object", properties: {} } } },
  ] as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — Clem persona", () => {
  it("clem uses CLEM_SYSTEM_PROMPT not Consuela", async () => {
    await post({ message: "hi", agent: "clem" });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemContents = sent.messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n");
    expect(systemContents).toContain("You are Clem");
    expect(systemContents).not.toContain("You are Consuela");
  });

  it("clem tools are scoped to allowlist only", async () => {
    await post({ message: "hi", agent: "clem" });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const toolNames: string[] = (sent.tools || []).map((t: any) => t.function.name);
    const allowed = ["get_grocery_list", "get_pantry", "add_grocery_item", "complete_grocery_item", "get_weekly_meals", "get_recipes", "compare_grocery_prices"];
    for (const name of toolNames) {
      expect(allowed).toContain(name);
    }
    expect(toolNames).not.toContain("check_for_update");
    expect(toolNames).not.toContain("ha_control_device");
    expect(toolNames).not.toContain("get_proactive_suggestions");
    // buildToolsForOpenAI called with houseControl:false for Clem
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false });
  });

  it("non-clem parent session still gets full tools and Consuela prompt", async () => {
    // No session → child default → kid soul (by design since 2026-09-06);
    // the adult Consuela prompt requires a real parent session.
    const { signSession, SESSION_COOKIE } = await import("@/lib/session");
    process.env.SESSION_SECRET = "test-secret-0123456789";
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    await post({ message: "hi" }, `${SESSION_COOKIE}=${token}`);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemContent = sent.messages[0].content as string;
    expect(systemContent).toContain("Dashboard Agent");
    // non-clem should have all tools (mock returns 10)
    expect(sent.tools.length).toBe(10);
  });

  it("system addendum appended as second system message and truncated to 2000", async () => {
    const longAddendum = "a".repeat(2500);
    await post({ message: "hi", agent: "clem", system: longAddendum });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemMsgs = sent.messages.filter((m: any) => m.role === "system");
    expect(systemMsgs.length).toBe(2);
    expect(systemMsgs[0].content).toContain("You are Clem");
    expect(systemMsgs[1].content.length).toBe(2000);
    expect(systemMsgs[1].content).toBe("a".repeat(2000));
  });

  it("system addendum trimmed and ignored if empty", async () => {
    await post({ message: "hi", agent: "clem", system: "   " });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemMsgs = sent.messages.filter((m: any) => m.role === "system");
    expect(systemMsgs.length).toBe(1);
  });

  it("system addendum appended for non-clem as well", async () => {
    await post({ message: "hi", system: "extra persona hint" });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemMsgs = sent.messages.filter((m: any) => m.role === "system");
    expect(systemMsgs.length).toBe(2);
    expect(systemMsgs[1].content).toBe("extra persona hint");
  });

  it("clem skips persistChatPair (no DB insert)", async () => {
    await post({ message: "hello clem", agent: "clem" });
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("non-clem persists chat pair", async () => {
    await post({ message: "hello consuela" });
    // should insert user + assistant
    expect(mocks.insertChatMessage).toHaveBeenCalledTimes(2);
  });

  it("clem rides the same resolved chain — fetches the mocked target URL", async () => {
    mocks.resolveChatTargets.mockImplementation(async () => [
      { url: "http://clem-brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
    ]);
    await post({ message: "hi", agent: "clem" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://clem-brain.local");
  });

  it("default agent rides the same resolved chain — identical URL as clem", async () => {
    mocks.resolveChatTargets.mockImplementation(async () => [
      { url: "http://clem-brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
    ]);
    await post({ message: "hi" });
    const consuelaUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(consuelaUrl).toContain("http://clem-brain.local");

    await post({ message: "hi", agent: "clem" });
    const clemUrl = (globalThis.fetch as any).mock.calls[1][0] as string;
    expect(clemUrl).toContain("http://clem-brain.local");
    // Same chain for both agents — the resolver never branches on agent.
    expect(clemUrl).toBe(consuelaUrl);
  });
});

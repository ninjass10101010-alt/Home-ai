import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  getServiceConfig: vi.fn(async (..._args: unknown[]) => null as string | null),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/services/config", () => ({
  getServiceConfig: mocks.getServiceConfig,
}));

vi.mock("@/db", () => ({
  db: { insertChatMessage: mocks.insertChatMessage },
}));

import { POST } from "@/app/api/hermes/chat/route";

function hermesReply(content = "ok") {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

async function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubEnv("HERMES_API_KEY", "");
  // Ensure env fallback doesn't interfere with 8642 fallback check
  vi.stubEnv("HERMES_API_URL", "");
  // @ts-ignore
  delete process.env.HERMES_URL;
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
  mocks.buildToolsForOpenAI.mockClear();
  mocks.getTool.mockClear();
  mocks.insertChatMessage.mockClear();
  mocks.getServiceConfig.mockReset().mockImplementation(async () => null);
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

  it("non-clem still gets full tools and Consuela prompt", async () => {
    await post({ message: "hi" });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemContent = sent.messages[0].content as string;
    expect(systemContent).toContain("You are Consuela");
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

  it("fallback URL is :8643 when no registry or env", async () => {
    await post({ message: "hi" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://hermes-agent-2:8643");
    expect(fetchUrl).not.toContain("8642");
  });

  it("clem hardcodes the Consuela gateway :8643 regardless of registry/env", async () => {
    mocks.getServiceConfig.mockImplementation(async (service: unknown, key: unknown) =>
      service === "hermes" && key === "HERMES_API_URL" ? "http://finance:8642" : null
    );
    await post({ message: "hi", agent: "clem" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://hermes-agent-2:8643");
  });

  it("registry HERMES_API_URL takes precedence over fallback", async () => {
    mocks.getServiceConfig.mockImplementation(async (service: unknown, key: unknown) =>
      service === "hermes" && key === "HERMES_API_URL" ? "http://custom:9999" : null
    );
    await post({ message: "hi" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://custom:9999");
  });

  it("env HERMES_API_URL used when registry null", async () => {
    vi.stubEnv("HERMES_API_URL", "http://env-host:8642");
    await post({ message: "hi" });
    const fetchUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toContain("http://env-host:8642");
  });
});

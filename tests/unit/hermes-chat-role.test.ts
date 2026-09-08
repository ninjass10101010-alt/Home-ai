// MF-3 — chat house-control gating must derive the role from the signed
// session cookie, never from the request body (any kid could post
// role:"parent" and unlock ha_control_device).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [testTarget()]),
  resetAiTargetsForTests: vi.fn(),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

vi.mock("@/db", () => ({
  db: { insertChatMessage: mocks.insertChatMessage },
}));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";
import type { AiTarget } from "@/lib/ai/targets";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const testTarget = (over: Partial<AiTarget> = {}): AiTarget => ({
  url: "http://brain.local",
  key: "test-key",
  model: "test-model",
  provider: "test",
  fallback: false,
  ...over,
});

function hermesReply() {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    { status: 200 }
  );
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
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [testTarget()]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — house-control role from session only", () => {
  it("body role:\"parent\" WITHOUT a valid session yields NO house tools", async () => {
    const res = await post({ message: "turn on the lights", role: "parent" });
    expect(res.status).toBe(200);

    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
    // And the house-control prompt addendum never reaches Hermes either.
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.messages[0].content).not.toContain("House control");
  });

  it("valid parent session cookie yields house tools regardless of a child body role", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const res = await post(
      { message: "turn on the lights", role: "child" },
      `${SESSION_COOKIE}=${token}`
    );
    expect(res.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: true, role: "parent" });
  });

  it("child session cookie never gets house tools even with parent body role", async () => {
    const token = await signSession({ memberId: "m2", name: "Caspian", role: "child" });
    const res = await post(
      { message: "open the garage", role: "parent" },
      `${SESSION_COOKIE}=${token}`
    );
    expect(res.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
  });

  it("no cookie at all defaults to child-role (no house tools)", async () => {
    const res = await post({ message: "hi" });
    expect(res.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
  });
});

describe("hermes chat — kid soul for child sessions (2026-09-06)", () => {
  it("child session gets the KID prompt naming the child, never the adult soul", async () => {
    const token = await signSession({ memberId: "m3", name: "Emily", role: "child" });
    const res = await post({ message: "hi" }, `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    // Kid boot file (ai/KID.md) + per-child greeting.
    expect(sent.messages[0].content).toContain("Kid Soul (child sessions ONLY)");
    expect(sent.messages[0].content).toContain("You are talking with Emily today.");
    // The adult soul files never leak into the kid prompt.
    expect(sent.messages[0].content).not.toContain("Dashboard Tool Reference (Consuela)");
    expect(sent.messages[0].content).not.toContain("trigger_update");
  });

  it("parent session keeps the adult soul with admin + house-control lines", async () => {
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const res = await post({ message: "hi" }, `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    // Adult boot files: SOUL + IDENTITY + TOOLS + house-control addendum.
    expect(sent.messages[0].content).toContain("Dashboard Agent");
    expect(sent.messages[0].content).toContain("Dashboard Tool Reference (Consuela)");
    expect(sent.messages[0].content).toContain("trigger_update");
    expect(sent.messages[0].content).toContain("House control");
    // The kid soul never leaks into the parent prompt.
    expect(sent.messages[0].content).not.toContain("Kid Soul (child sessions ONLY)");
  });
});

describe("hermes chat — resolved auth header is actually sent", () => {
  it("resolver-provided target key goes out as Authorization: Bearer", async () => {
    mocks.resolveChatTargets.mockImplementation(async () => [testTarget({ key: "registry-key-456" })]);
    await post({ message: "hi" });

    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer registry-key-456");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("target with a null key sends NO Authorization header", async () => {
    mocks.resolveChatTargets.mockImplementation(async () => [testTarget({ key: null })]);
    await post({ message: "hi" });

    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(Object.keys(init.headers)).not.toContain("Authorization");
  });
});

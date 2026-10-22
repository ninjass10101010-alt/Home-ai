import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [testTarget()]),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContextBlock: vi.fn(async () => ""),
  detectCaptures: vi.fn(() => []),
  storeMemory: vi.fn(async () => ({ id: "m1", key: "allergy_peanuts_bailey" })),
  writePlaybook: vi.fn(async () => ({ id: "p1", slug: "meals.add_meal" })),
  liveMembers: vi.fn(async () => [{ name: "Bailey", role: "child" }]),
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
  getAuthedPB: vi.fn(async () => ({})),
}));

vi.mock("@/lib/hermes-tools", () => ({
  buildToolsForOpenAI: mocks.buildToolsForOpenAI,
  getTool: mocks.getTool,
}));

vi.mock("@/lib/ai/targets", () => ({
  resolveChatTargets: mocks.resolveChatTargets,
  resetAiTargetsForTests: mocks.resetAiTargetsForTests,
}));

vi.mock("@/lib/memory-context", () => ({
  buildMemoryContextBlock: mocks.buildMemoryContextBlock,
}));

vi.mock("@/lib/memory-capture", () => ({
  detectCaptures: mocks.detectCaptures,
}));

vi.mock("@/lib/family-memory", () => ({
  storeMemory: mocks.storeMemory,
  queryMemories: vi.fn(async () => []),
  listActiveFacts: vi.fn(async () => []),
  deleteMemory: vi.fn(async () => true),
  incrementMemoryUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/memory-playbooks", () => ({
  writePlaybook: mocks.writePlaybook,
  listActivePlaybooks: vi.fn(async () => []),
}));

vi.mock("@/lib/consuela/live-reads", () => ({
  liveMembers: mocks.liveMembers,
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
  const res = await POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) await res.text();
  return res;
}

const LIVE_MEMBERS: Record<string, { id: string; name: string; role: string }> = {
  m1: { id: "m1", name: "Rebecca", role: "parent" },
  m2: { id: "m2", name: "Caspian", role: "child" },
};

beforeEach(() => {
  resetAiChatForTests();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
  mocks.detectCaptures.mockClear().mockReturnValue([]);
  mocks.storeMemory.mockClear().mockResolvedValue({ id: "m1", key: "allergy_peanuts_bailey" });
  mocks.writePlaybook.mockClear().mockResolvedValue({ id: "p1", slug: "meals.add_meal" });
  mocks.liveMembers.mockClear().mockResolvedValue([{ name: "Bailey", role: "child" }]);
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [testTarget()]);
  mocks.withAdmin.mockReset().mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) =>
    fn({
      collection: () => ({
        getOne: async (id: string) => {
          const row = LIVE_MEMBERS[id];
          if (!row) throw Object.assign(new Error("not found"), { status: 404 });
          return { ...row };
        },
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — capture (2026-10-21)", () => {
  it("auto-stores an explicit allergy and announces it with an undo proposal", async () => {
    mocks.detectCaptures.mockReturnValue([
      { kind: "fact", content: "Bailey is allergic to peanuts", category: "allergy", person: "Bailey", topic: "peanuts", subject: "allergy_peanuts_bailey", confidence: "high", reason: "explicit_allergy" },
    ] as any);
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    const res = await POST(new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ message: "Bailey is allergic to peanuts", stream: true }),
    }));
    expect(res.status).toBe(200);
    // Drain the streamed body so the async loop (and capture) finishes.
    const body = await res.text();
    expect(mocks.storeMemory).toHaveBeenCalled();
    expect(body).toContain("remember_memory");
  });

  it("never captures from a child session", async () => {
    mocks.detectCaptures.mockReturnValue([]);
    mocks.liveMembers.mockResolvedValue([{ name: "Caspian", role: "child" }]);
    const token = await signSession({ memberId: "m2", name: "Caspian", role: "child" });
    await post({ message: "I love pizza", stream: true }, `${SESSION_COOKIE}=${token}`);
    expect(mocks.storeMemory).not.toHaveBeenCalled();
  });

  it("does not capture when the detector finds nothing", async () => {
    mocks.detectCaptures.mockReturnValue([]);
    mocks.liveMembers.mockResolvedValue([{ name: "Bailey", role: "child" }]);
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    await post({ message: "what is for dinner", stream: true }, `${SESSION_COOKIE}=${token}`);
    expect(mocks.storeMemory).not.toHaveBeenCalled();
  });
});

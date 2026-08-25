// MF-3 — chat house-control gating must derive the role from the signed
// session cookie, never from the request body (any kid could post
// role:"parent" and unlock ha_control_device).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  getServiceConfig: vi.fn(async () => null as string | null),
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
import { signSession, SESSION_COOKIE } from "@/lib/session";

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
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  // Empty (not unset) so the no-auth case is deterministic even if the host
  // shell exports HERMES_API_KEY — "" is falsy → no Authorization header.
  vi.stubEnv("HERMES_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
  mocks.buildToolsForOpenAI.mockClear();
  mocks.getTool.mockClear();
  mocks.insertChatMessage.mockClear();
  mocks.getServiceConfig.mockReset().mockImplementation(async () => null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hermes chat — house-control role from session only", () => {
  it("body role:\"parent\" WITHOUT a valid session yields NO house tools", async () => {
    const res = await post({ message: "turn on the lights", role: "parent" });
    expect(res.status).toBe(200);

    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false });
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
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: true });
  });

  it("child session cookie never gets house tools even with parent body role", async () => {
    const token = await signSession({ memberId: "m2", name: "Caspian", role: "child" });
    const res = await post(
      { message: "open the garage", role: "parent" },
      `${SESSION_COOKIE}=${token}`
    );
    expect(res.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false });
  });

  it("no cookie at all defaults to child-role (no house tools)", async () => {
    const res = await post({ message: "hi" });
    expect(res.status).toBe(200);
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false });
  });
});

describe("hermes chat — resolved auth header is actually sent", () => {
  it("registry-resolved HERMES_API_KEY goes out as Authorization: Bearer", async () => {
    mocks.getServiceConfig.mockImplementation(
      async (service: string, key: string) =>
        service === "hermes" && key === "HERMES_API_KEY" ? "registry-key-456" : null
    );
    await post({ message: "hi" });

    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer registry-key-456");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("null config (and no env fallback) sends NO Authorization header", async () => {
    mocks.getServiceConfig.mockImplementation(async () => null);
    await post({ message: "hi" });

    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(Object.keys(init.headers)).not.toContain("Authorization");
  });
});

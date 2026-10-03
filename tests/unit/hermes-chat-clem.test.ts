// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  buildToolsForOpenAI: vi.fn(() => []),
  getTool: vi.fn(() => undefined),
  insertChatMessage: vi.fn(async () => ({})),
  resolveChatTargets: vi.fn(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]),
  resetAiTargetsForTests: vi.fn(),
  buildMemoryContext: vi.fn(async () => ""),
}));

// The live-identity read the writer path now requires goes through the members
// collection; these rows are keyed by the memberIds the tests sign cookies with.
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

const LIVE_MEMBERS: Record<string, { id: string; name: string; role: string }> = {
  m1: { id: "m1", name: "Rebecca", role: "parent" },
  m2: { id: "m2", name: "Caspian", role: "child" },
};

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

// The sheet is the SECOND live streamConsuelaChat consumer — chat-stream always
// posts stream:true — and it is rendered from onToken alone, so it needs its own
// handle on the client seam the route's attempt frames drive.
const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));
const toastMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({
  default: ({ children }: { children?: any }) => createElement("div", null, children),
}));

import { POST, resetAiChatForTests } from "@/app/api/hermes/chat/route";
import ClemAssistant from "@/components/meals/ClemAssistant";

function hermesReply(content = "ok") {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

/** Default to a signed-in live PARENT; pass "" for the anonymous case. */
async function parentCookie() {
  const { signSession, SESSION_COOKIE } = await import("@/lib/session");
  return `${SESSION_COOKIE}=${await signSession({ memberId: "m1", name: "Rebecca", role: "parent" })}`;
}

async function post(body: Record<string, unknown>, cookie?: string) {
  const res = await POST(
    new NextRequest("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie !== undefined ? { cookie } : { cookie: await parentCookie() }),
      },
      body: JSON.stringify(body),
    })
  );
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) await res.text();
  return res;
}

beforeEach(() => {
  resetAiChatForTests();
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  vi.stubGlobal("fetch", vi.fn(async () => hermesReply()));
  streamMock.fn.mockReset();
  toastMock.fn.mockReset();
  mocks.buildToolsForOpenAI.mockClear();
  mocks.getTool.mockClear();
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
  mocks.insertChatMessage.mockClear();
  mocks.resolveChatTargets.mockReset().mockImplementation(async () => [
    { url: "http://brain.local", key: "test-key", model: "test-model", provider: "test", fallback: false },
  ]);
  // Default tools: include both clem and non-clem to verify filtering.
  // Role-aware (mirrors the real contract): role "child" → KID_TOOL_NAMES
  // reads only; otherwise the full adult surface minus nothing (houseControl
  // is handled by the caller's mock arg, not emulated here beyond kid-filter).
  const ALL_TOOLS = [
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
  ] as any;
  const MOCK_KID_TOOLS = ALL_TOOLS.filter(
    (t: any) => !["add_grocery_item", "complete_grocery_item", "compare_grocery_prices", "check_for_update", "ha_control_device"].includes(t.function.name)
  );
  mocks.buildToolsForOpenAI.mockImplementation((opts?: { role?: string }) =>
    opts?.role === "child" ? MOCK_KID_TOOLS : ALL_TOOLS
  );
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
    const { signSession, SESSION_COOKIE } = await import("@/lib/session");
    process.env.SESSION_SECRET = "test-secret-0123456789";
    const childToken = await signSession({ memberId: "m2", name: "Caspian", role: "child" });
    await post({ message: "hi", agent: "clem" }, `${SESSION_COOKIE}=${childToken}`);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const toolNames: string[] = (sent.tools || []).map((t: any) => t.function.name);
    const allowed = ["get_grocery_list", "get_pantry", "add_grocery_item", "complete_grocery_item", "get_weekly_meals", "get_recipes", "compare_grocery_prices"];
    for (const name of toolNames) {
      expect(allowed).toContain(name);
    }
    expect(toolNames).not.toContain("check_for_update");
    expect(toolNames).not.toContain("ha_control_device");
    expect(toolNames).not.toContain("get_proactive_suggestions");
    // buildToolsForOpenAI called with houseControl:false + the LIVE
    // session-derived role for Clem (a child session → kid read-only surface)
    expect(mocks.buildToolsForOpenAI).toHaveBeenCalledWith({ houseControl: false, role: "child" });
  });

  it("non-clem parent session still gets full tools and Consuela prompt", async () => {
    // No session → child default → kid soul (by design since 2026-09-06);
    // the adult Consuela prompt requires a real parent session.
    const { signSession, SESSION_COOKIE } = await import("@/lib/session");
    process.env.SESSION_SECRET = "test-secret-0123456789";
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    await post({ message: "hi", stream: true }, `${SESSION_COOKIE}=${token}`);
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
    await post({ message: "hi", stream: true, system: "extra persona hint" });
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const systemMsgs = sent.messages.filter((m: any) => m.role === "system");
    expect(systemMsgs.length).toBe(2);
    expect(systemMsgs[1].content).toBe("extra persona hint");
  });

  it("clem skips persistChatPair (no DB insert)", async () => {
    await post({ message: "hello clem", agent: "clem" });
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("a streamed non-clem family-thread turn persists chat pair", async () => {
    await post({ message: "hello consuela", stream: true });
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

describe("Clem role gate — child/pet/guest sessions get read-only grocery tools", () => {
  it("an anonymous clem session gets NO write tools and stores nothing", async () => {
    // An unverified caller keeps the answer (the exempted read the
    // signed-out sheet depends on) but never a tool and never the store.
    const res = await post({ message: "add milk to the list", agent: "clem" }, "");
    expect(res.status).toBe(200);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.tools).toBeUndefined();
    expect(mocks.buildToolsForOpenAI).not.toHaveBeenCalled();
    expect(mocks.insertChatMessage).not.toHaveBeenCalled();
  });

  it("child clem session arms NO write tools", async () => {
    const { signSession, SESSION_COOKIE } = await import("@/lib/session");
    process.env.SESSION_SECRET = "test-secret-0123456789";
    const token = await signSession({ memberId: "m2", name: "Caspian", role: "child" });
    await post({ message: "add milk to the list", agent: "clem" }, `${SESSION_COOKIE}=${token}`);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const toolNames: string[] = (sent.tools || []).map((t: any) => t.function.name);
    expect(toolNames).not.toContain("add_grocery_item");
    expect(toolNames).not.toContain("complete_grocery_item");
    expect(toolNames).toContain("get_pantry");
  });

  it("parent clem session keeps the full 7-tool grocery surface incl. writes", async () => {
    const { signSession, SESSION_COOKIE } = await import("@/lib/session");
    process.env.SESSION_SECRET = "test-secret-0123456789";
    const token = await signSession({ memberId: "m1", name: "Rebecca", role: "parent" });
    await post({ message: "add milk to the list", agent: "clem" }, `${SESSION_COOKIE}=${token}`);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    const toolNames: string[] = (sent.tools || []).map((t: any) => t.function.name);
    expect(toolNames).toContain("add_grocery_item");
    expect(toolNames).toContain("complete_grocery_item");
    expect(toolNames).toContain("compare_grocery_prices");
    expect(toolNames).toHaveLength(7);
  });
});

// Every post() above is BUFFERED — which is why the streamed sheet went unproven:
// chat-stream always sends stream:true, so ClemAssistant is a second live
// consumer of the same wire protocol, and it renders from onToken alone. The
// route announces each (round × target) provider call with an attempt frame and
// persists ONLY the answering one, so a sheet that ignores those frames shows a
// dead target's words through the next attempt's whole reasoning phase — and, on
// failure, keeps them for good.
describe("Clem sheet — streamed attempt frames", () => {
  let root: ReturnType<typeof createRoot> | null = null;

  function openSheet(): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    act(() => {
      root = createRoot(el);
      root.render(createElement(ClemAssistant, {
        groceryItems: [], pantryItems: [], storeContext: "",
        addGroceryItem: async () => {}, showToast: toastMock.fn,
      } as any));
    });
    act(() => { el.querySelector<HTMLButtonElement>("button[aria-label='Ask Clem']")!.click(); });
    return el;
  }

  // The quick prompt is the one send path with no controlled-input state to drive.
  async function askClem(el: HTMLElement) {
    const chip = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "What should I order?")!;
    await act(async () => { chip.click(); });
    return streamMock.fn.mock.calls[0][0] as any;
  }

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    document.body.innerHTML = "";
  });

  it("drops a superseded target's words from the sheet on the next attempt frame", async () => {
    let opts: any = null;
    streamMock.fn.mockImplementation(async (o: any) => { opts = o; return new Promise(() => {}); });
    const el = openSheet();
    const sent = await askClem(el);

    act(() => { sent.onToken("orphaned half", "orphaned half"); });
    expect(el.textContent).toContain("orphaned half");

    // The failover: target t1 takes the round over, and its answer replaces the
    // dead text rather than being appended to it.
    act(() => { sent.onAttempt?.({ round: 1, target: "t1" }); });
    expect(el.textContent).not.toContain("orphaned half");
    act(() => { sent.onToken("Backup answer.", "Backup answer."); });
    expect(el.textContent).toContain("Backup answer.");
    // One reply row, not two.
    expect((el.textContent?.match(/orphaned half/g) || []).length).toBe(0);
  });

  it("keeps no dead row in the sheet when the stream fails mid-answer", async () => {
    let reject!: (e: Error) => void;
    streamMock.fn.mockImplementation(async () => new Promise((_res, rej) => { reject = rej; }));
    const el = openSheet();
    const sent = await askClem(el);

    act(() => { sent.onToken("orphaned half", "orphaned half"); });
    await act(async () => { reject(new Error("boom")); });

    expect(toastMock.fn).toHaveBeenCalled();
    expect(el.textContent).not.toContain("orphaned half");
  });
});

import { NextRequest, NextResponse } from "next/server";
import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";
import { db } from "@/db";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildClemSystemPrompt, buildConsuelaSystemPrompt, buildKidSystemPrompt, HOUSE_CONTROL_PROMPT_ADDENDUM } from "@/lib/consuela-prompts";
import { buildMemoryContext } from "@/lib/family-memory";
import { MEMORY_USER_ID, MEMORY_FAMILY_ID } from "@/lib/memory-ids";
import { resolveChatTargets, resetAiTargetsForTests, type AiTarget } from "@/lib/ai/targets";

export const dynamic = "force-dynamic";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

async function persistChatPair(request: NextRequest, userMessage: string, assistantReply: string, userId: string) {
  try {
    // I1 — don't persist empty/fallback replies: they're thread spam and give
    // the daily thread nothing useful for later rounds.
    const reply = String(assistantReply || "").trim();
    if (!reply || reply === "I processed that.") return;
    // F1 — the caller threads the signed-in session's name through; there is
    // no client cookie to read (the old x-consuela-user cookie was set by
    // nobody, so every row saved as "guest"). Signed-out stays "guest" — honestly.
    const attributedUserId = userId || "guest";
    const threadId = todayISO();
    // Explicit createdAt keeps the user row strictly before the assistant row
    // in the createdAt-ascending thread sort even when both land in the same ms.
    const userAt = new Date();
    const assistantAt = new Date(userAt.getTime() + 1);
    await Promise.all([
      db.insertChatMessage({ userId: attributedUserId, role: "user", content: userMessage, source: "dashboard", threadId, createdAt: userAt.toISOString() }),
      db.insertChatMessage({ userId: "consuela", role: "assistant", content: reply, source: "dashboard", threadId, createdAt: assistantAt.toISOString() }),
    ]);
  } catch (e: any) {
    console.error("Failed to persist chat messages:", e?.message || e);
  }
}

const AI_TIMEOUT_MS = 60_000;

// Flipped to false the first time the active provider answers a stream:true
// request with a buffered JSON payload — stop paying the failed attempt on
// every round until the process restarts.
let aiStreamingSupported = true;

/** Test-only: clears the module-scope caches between vitest cases. */
export function resetAiChatForTests() {
  resetAiTargetsForTests();
  aiStreamingSupported = true;
}

const CLEM_TOOLS = [
  "get_grocery_list",
  "get_pantry",
  "add_grocery_item",
  "complete_grocery_item",
  "get_weekly_meals",
  "get_recipes",
  "compare_grocery_prices",
];
const MAX_ROUNDS = 4;

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

function parseToolArgs(raw: string | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function callAi(
  messages: ChatMessage[],
  opts: { maxTokens?: number; tools?: ReturnType<typeof buildToolsForOpenAI>; toolChoice?: "auto" | "none"; target: AiTarget },
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const target = opts.target;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.key) headers.Authorization = `Bearer ${target.key}`;
  const res = await fetch(`${target.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: target.model,
      messages,
      temperature: 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      tools: opts.tools,
      tool_choice: opts.toolChoice ?? "auto",
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`AI ${target.model} ${res.status}: ${err || res.statusText}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    tool_calls: data.choices?.[0]?.message?.tool_calls,
  };
}

function sseFrame(payload: string, event?: string): string {
  return (event ? `event: ${event}\n` : "") + `data: ${payload}\n\n`;
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  get_weather: "Checking the weather…",
  get_todays_events: "Checking today's events…",
  get_todays_schedule: "Checking today's routines…",
  get_pending_tasks: "Checking the task list…",
  add_task: "Adding that task…",
  complete_task: "Marking that task done…",
  get_weekly_meals: "Checking the meal plan…",
  get_recipes: "Looking through the recipe box…",
  get_grocery_list: "Checking the grocery list…",
  add_grocery_item: "Adding to the grocery list…",
  complete_grocery_item: "Updating the grocery list…",
  get_pantry: "Checking the pantry…",
  add_event: "Adding that to the calendar…",
  remove_event: "Removing that from the calendar…",
  get_dashboard_summary: "Pulling today's summary…",
  get_proactive_suggestions: "Reviewing my suggestions…",
  action_suggestion: "Taking care of that suggestion…",
  dismiss_suggestion: "Tidying up suggestions…",
  compare_grocery_prices: "Comparing store prices…",
  ha_list_devices: "Looking up house devices…",
  ha_control_device: "Adjusting that device…",
  check_for_update: "Checking for dashboard updates…",
  trigger_update: "Updating the dashboard…",
  get_container_status: "Checking the containers…",
  restart_container: "Restarting that container…",
  check_pocketbase: "Checking the database…",
  remember_fact: "Committing that to memory…",
  recall_memories: "Checking my memory…",
  forget_memory: "Letting that memory go…",
};
function toolStatusLabel(name?: string): string {
  return (name && TOOL_STATUS_LABELS[name]) || "Working on it…";
}

/**
 * One streaming AI round. Content deltas are forwarded to `write` live;
 * tool-call deltas are accumulated and returned for the loop to execute.
 * Falls back to a buffered read when the provider doesn't honor stream:true
 * (and remembers, so later rounds skip the attempt until process restart).
 */
async function callAiStream(
  messages: ChatMessage[],
  opts: { tools?: ReturnType<typeof buildToolsForOpenAI>; target: AiTarget },
  write: (frame: string) => void,
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.target.key) headers.Authorization = `Bearer ${opts.target.key}`;
  // Fallback providers stream buffered (their SSE dialects vary); the brain
  // streams when it can.
  const wantStream = aiStreamingSupported && !opts.target.fallback;
  const res = await fetch(`${opts.target.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: opts.target.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      tools: opts.tools,
      tool_choice: "auto",
      ...(wantStream ? { stream: true } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`AI ${opts.target.model} ${res.status}: ${err || res.statusText}`);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!wantStream || !ctype.includes("text/event-stream") || !res.body) {
    if (wantStream && !ctype.includes("text/event-stream")) aiStreamingSupported = false;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    // Buffered answer — surface it downstream as one token frame so the
    // client's SSE contract holds either way.
    if (content) write(sseFrame(JSON.stringify({ t: content })));
    return {
      content,
      tool_calls: data.choices?.[0]?.message?.tool_calls,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = rawFrame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      if (payload === "[DONE]") continue;
      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { continue; }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        write(sseFrame(JSON.stringify({ t: delta.content })));
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: tc.id, function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function!.name = (toolCalls[i].function!.name || "") + tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function!.arguments = (toolCalls[i].function!.arguments || "") + tc.function.arguments;
        }
      }
    }
  }
  return { content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
}

/** Execute one round's tool calls concurrently; results keep call order. */
async function runToolCalls(
  toolCalls: ToolCall[],
  tools: ReturnType<typeof buildToolsForOpenAI>,
): Promise<string[]> {
  return Promise.all(toolCalls.map(async (tc) => {
    const name = tc.function?.name;
    // Allowlist first: the model only ever sees the session's `tools`, but a
    // prompt injection could name any registry tool. getTool searching the
    // FULL registry must never let a call outside the allowlist execute.
    const tool = name && tools.some((t) => t.function.name === name) ? getTool(name) : undefined;
    if (!name || !tool) {
      const available = tools.map((t) => t.function.name).join(", ");
      return JSON.stringify({ error: `Unknown tool: ${name ?? "<missing name>"}. Available: ${available}` });
    }
    try {
      return await tool.handler(parseToolArgs(tc.function?.arguments));
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || "Tool failed" });
    }
  }));
}

interface ChatRequestBody {
  message?: string; history?: any[]; role?: string; system?: string; agent?: string; stream?: boolean;
}

/**
 * Shared preamble for both chat modes: session-derived role, agent routing,
 * tool scoping, and the message stack. Used by the buffered POST and the
 * streamed handler so the two paths can never drift.
 */
async function buildChatContext(request: NextRequest, body: ChatRequestBody) {
  const { history = [], system, agent } = body;
  const message = body.message ?? "";
  // MF-3 — role comes from the signed session cookie only; body.role is
  // ignored entirely (any kid could otherwise post role:"parent"). No valid
  // session → child-role default: no house-control tools.
  // F3 — PARENT ALLOWLIST (the Ledger-gate idiom): the roster's third role
  // "pet" (Rocco/Rico, default PIN 0000) is NOT an adult. Everything that
  // isn't a parent session — child, pet, guest — gets the kid soul and the
  // kid tool surface exactly as child sessions do today.
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isAdult = session?.role === "parent";
  const role = isAdult ? "parent" : "child";
  const houseControl = isAdult;
  const isClem = agent === "clem";
  // Clem used to hardcode a gateway URL — now every agent rides the same
  // dashboard-owned chain (Task 4 of the 2026-09-07 brain cutover).
  const targets = await resolveChatTargets();
  const tools = isClem
    ? buildToolsForOpenAI({ houseControl: false }).filter((t) => CLEM_TOOLS.includes(t.function.name))
    : buildToolsForOpenAI({ houseControl, role });
  const recentHistory = (history || [])
    .slice(-6)
    .filter((h: any) => h && typeof h.content === "string" && h.content.trim())
    .map((h: any) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    }));
  // Kid soul (2026-09-06): child sessions get the kid-friendly voice and the
  // read-only tool surface — never the adult soul. F3: the normalized `role`
  // routes child/pet/guest ALL down this path. Parents are unchanged.
  let baseSystem = isClem
    ? buildClemSystemPrompt()
    : role === "child"
      ? buildKidSystemPrompt(undefined, session?.name)
      : buildConsuelaSystemPrompt() + (houseControl ? HOUSE_CONTROL_PROMPT_ADDENDUM : "");
  // F4 — adult continuity: the memory bank rides along in every parent prompt
  // (self-formats as "Family Context: …"). Never for child/pet/guest/Clem,
  // and a dead memory store must never break chat — degrade to no context.
  if (isAdult && !isClem) {
    const memCtx = await buildMemoryContext(MEMORY_USER_ID, MEMORY_FAMILY_ID, message).catch(() => "");
    if (memCtx) baseSystem += memCtx;
  }
  let addendum: string | null = null;
  if (typeof system === "string") {
    const trimmed = system.trim();
    if (trimmed) addendum = trimmed.slice(0, 2000);
  }
  const messages: ChatMessage[] = [
    { role: "system", content: baseSystem },
    ...(addendum ? [{ role: "system" as const, content: addendum }] : []),
    ...recentHistory,
    { role: "user", content: message },
  ];
  return { message, isClem, targets, tools, messages, role, sessionName: session?.name };
}

async function handleStreamedChat(request: NextRequest, body: ChatRequestBody): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (frame: string) => { writer.write(enc.encode(frame)).catch(() => { /* client gone */ }); };

  (async () => {
    try {
      const { message, isClem, targets, tools, messages, sessionName } = await buildChatContext(request, body);
      let finalContent = "";
      if (targets.length === 0) {
        write(sseFrame(JSON.stringify({ message: "My brain isn't configured yet — add a provider in Settings → AI Models." }), "error"));
        return;
      }
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let content = "";
        let tool_calls: ToolCall[] | undefined;
        let lastErr: unknown = null;
        for (const target of targets) {
          try {
            ({ content, tool_calls } = await callAiStream(messages, { tools, target }, write));
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            console.warn(`[ai] stream target ${target.model} failed: ${(err as Error).message}`);
          }
        }
        if (lastErr) {
          throw lastErr;
        }
        if (!tool_calls || tool_calls.length === 0) {
          finalContent = content;
          break;
        }
        messages.push({ role: "assistant", content, tool_calls });
        for (const tc of tool_calls) {
          write(sseFrame(JSON.stringify({ label: toolStatusLabel(tc.function?.name) }), "status"));
        }
        const results = await runToolCalls(tool_calls, tools);
        results.forEach((result, i) =>
          messages.push({ role: "tool", tool_call_id: tool_calls[i].id || "", content: result }));
      }
      if (!finalContent) {
        finalContent = "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧";
        // Streamed clients must see exactly what gets persisted.
        write(sseFrame(JSON.stringify({ t: finalContent })));
      }
      if (!isClem) await persistChatPair(request, message, finalContent, sessionName || "");
      write(sseFrame("[DONE]"));
    } catch (error: any) {
      console.error("Consuela stream error:", error?.message || error);
      write(sseFrame(JSON.stringify({ message: "Hey, I hit a snag connecting to my brain right now. Give me a moment and try again! 🔧" }), "error"));
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message } = body;
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (body.stream === true) {
    return handleStreamedChat(request, body);
  }

  try {
    const { isClem, targets, tools, messages, role, sessionName } = await buildChatContext(request, body);
    console.log(`[ai] agent=${body.agent || "consuela"} isClem=${isClem} brain=${targets[0]?.provider}/${targets[0]?.model} role=${role}`);

    if (targets.length === 0) {
      return NextResponse.json({ content: "My brain isn't configured yet — add a provider in Settings → AI Models." });
    }

    let lastErr: unknown = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let content = "";
      let tool_calls: ToolCall[] | undefined;
      for (const target of targets) {
        try {
          ({ content, tool_calls } = await callAi(messages, {
            tools,
            toolChoice: "auto",
            target,
          }));
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[ai] target ${target.model} failed: ${(err as Error).message}`);
        }
      }
      if (lastErr) {
        throw lastErr;
      }

      if (!tool_calls || tool_calls.length === 0) {
        if (!isClem) await persistChatPair(request, message, content, sessionName || "");
        return NextResponse.json({ content });
      }

      messages.push({ role: "assistant", content, tool_calls });

      const results = await runToolCalls(tool_calls, tools);
      results.forEach((result, i) =>
        messages.push({ role: "tool", tool_call_id: tool_calls[i].id || "", content: result }));
    }

    return NextResponse.json({
      content:
        "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧",
    });
  } catch (error: any) {
    console.error("Consuela agent error:", error?.message || error);
    return NextResponse.json({
      content:
        "Hey, I hit a snag connecting to my brain right now. Give me a moment and try again! 🔧",
    });
  }
}

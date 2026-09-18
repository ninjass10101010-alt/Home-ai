import { NextRequest, NextResponse } from "next/server";
import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";
import { db } from "@/db";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildClemSystemPrompt, buildConsuelaSystemPrompt, buildKidSystemPrompt, HOUSE_CONTROL_PROMPT_ADDENDUM } from "@/lib/consuela-prompts";
import { buildMemoryContext } from "@/lib/family-memory";
import { MEMORY_USER_ID, MEMORY_FAMILY_ID } from "@/lib/memory-ids";
import { resolveChatTargets, resetAiTargetsForTests, type AiTarget } from "@/lib/ai/targets";
import { recordChatOutcome } from "@/lib/ai/health";
import { loadContextPack, type PackScope } from "@/lib/consuela/assistant-context";
import {
  isPlannerIntent,
  plannerMaxTokens,
  plannerSystemPrompt,
  plannerUserPrompt,
  validatePlannerOutput,
} from "@/lib/consuela/planner";

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
// Reasoning models (e.g. glm-5.3-flash) spend the token budget on hidden
// `reasoning_content` BEFORE any visible content — a 1024 cap gets eaten by
// thinking alone (verified live: finish_reason=length with zero content).
// 3072 leaves room for reasoning + a full answer; tool args stay small.
const AI_MAX_TOKENS = 3072;
// Status line shown when a streamed round produces reasoning but no content
// and no tool calls — the model is thinking, not dead.
const REASONING_STATUS = "Thinking deeply… this one needs a long think";

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
const MAX_ROUNDS = 6;
// The FINAL round of the loop is a forced tool-free "wrap-up": the model must
// answer with what it already gathered instead of chaining yet another lookup
// (fresh /new conversations love multi-tool read chains — this stops the bare
// "ran out of steps" fallback from being the common answer).
const WRAPUP_NOTE =
  "You have used all your research steps. Answer the user's question now using the information you already gathered — do not attempt any more lookups.";

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
  const payload: Record<string, unknown> = {
    model: target.model,
    messages,
    temperature: 0.7,
    max_tokens: opts.maxTokens ?? AI_MAX_TOKENS,
  };
  // A planner call arms ZERO tools — and some providers 400 on a tool_choice
  // that names no tool set, so BOTH keys are dropped together when no tools
  // were passed. Chat always passes tools, so its body stays byte-identical.
  if (opts.tools !== undefined) {
    payload.tools = opts.tools;
    payload.tool_choice = opts.toolChoice ?? "auto";
  }
  const res = await fetch(`${target.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify(payload),
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
  propose_point_adjustment: "Preparing that point adjustment…",
};
function toolStatusLabel(name?: string): string {
  return (name && TOOL_STATUS_LABELS[name]) || "Working on it…";
}

// Task 15 — chat never moves points. A successful propose_point_adjustment
// round yields an INERT proposal ({tool:"adjust_points", args}); the loop
// surfaces it to the client (streamed: extra `status` frame; buffered:
// top-level `proposals` array) so the chat page can render the parent-PIN
// confirm chip. Refusals (ok:false / no proposal) surface nothing extra.
const PROPOSAL_TOOL = "propose_point_adjustment";
function extractPointProposal(name: string | undefined, result: string): unknown | null {
  if (name !== PROPOSAL_TOOL) return null;
  try {
    const p = JSON.parse(result);
    if (p?.ok === true && p.proposal?.tool === "adjust_points" && p.proposal.args) {
      return p.proposal;
    }
  } catch { /* malformed tool result — nothing to surface */ }
  return null;
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
): Promise<{ content: string; tool_calls?: ToolCall[]; reasoningOnly?: boolean }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.target.key) headers.Authorization = `Bearer ${opts.target.key}`;
  // Fallback providers stream buffered (their SSE dialects vary); the brain
  // streams when it can.
  const wantStream = aiStreamingSupported && !opts.target.fallback;
  let reasoningAnnounced = false;
  const res = await fetch(`${opts.target.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: opts.target.model,
      messages,
      temperature: 0.7,
      max_tokens: AI_MAX_TOKENS,
      // tool_choice: auto only when tools exist (wrap-up sends neither —
      // providers that validate tool_choice against tools would 400).
      ...(opts.tools !== undefined ? { tools: opts.tools, tool_choice: "auto" } : {}),
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
      reasoningOnly: !content && !data.choices?.[0]?.message?.tool_calls,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningChars = 0;
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
      // Reasoning models think out loud before answering. Announce once so
      // the client's status line replaces the dead typing dots.
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        reasoningChars += delta.reasoning_content.length;
        if (!reasoningAnnounced) {
          reasoningAnnounced = true;
          write(sseFrame(JSON.stringify({ label: REASONING_STATUS }), "status"));
        }
      }
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
  // finish_reason=length with reasoning only → the token budget was consumed
  // by thinking. An EMPTY round is not an answer: report it so the caller can
  // fail over to the next target instead of emitting nothing.
  const reasoningOnly = content.length === 0 && toolCalls.length === 0 && reasoningChars > 0;
  return { content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined, reasoningOnly };
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
  intent?: string; options?: any;
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
    ? buildToolsForOpenAI({ houseControl: false, role }).filter((t) => CLEM_TOOLS.includes(t.function.name))
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
  let clientGone = false;
  const write = (frame: string) => {
    writer.write(enc.encode(frame)).catch(() => {
      // The requester disconnected mid-stream (tab closed / stopped / the 5-min
      // client watchdog fired). Server-side this is a distinct outcome from an
      // LLM failure — flag it so the health log says so.
      clientGone = true;
    });
  };
  const startedAt = Date.now();

  (async () => {
    // Health-recorder context hoisted so the catch path records rounds/brain too.
    const ctx = { agent: body.agent || "consuela", rounds: 0, brain: null as string | null, targets: 0 };
    try {
      const { message, isClem, targets, tools, messages, sessionName } = await buildChatContext(request, body);
      ctx.brain = targets.length ? `${targets[0].provider}/${targets[0].model}` : null;
      ctx.targets = targets.length;
      let finalContent = "";
      let answeredBy = "ok" as "ok" | "wrapup" | "exhausted";
      if (targets.length === 0) {
        recordChatOutcome({ outcome: "unconfigured", agent: ctx.agent, rounds: 0, ms: Date.now() - startedAt, brain: null, targets: 0 });
        write(sseFrame(JSON.stringify({ message: "My brain isn't configured yet — add a provider in Settings → AI Models." }), "error"));
        return;
      }
      for (let round = 0; round < MAX_ROUNDS; round++) {
        ctx.rounds = round + 1;
        // Final round = forced tool-free wrap-up: no tools are offered, so the
        // model must produce content from what it already gathered.
        const wrapup = round === MAX_ROUNDS - 1;
        let content = "";
        let tool_calls: ToolCall[] | undefined;
        let lastErr: unknown = null;
        for (const target of targets) {
          const callStarted = Date.now();
          try {
            ({ content, tool_calls } = await callAiStream(
              wrapup ? [...messages, { role: "system", content: WRAPUP_NOTE }] : messages,
              wrapup ? { target } : { tools, target },
              write,
            ));
            if (wrapup) tool_calls = undefined; // a wrap-up round never executes tools
            // An EMPTY round (reasoning consumed the budget, no content, no
            // tool calls) is not an answer — fail over to the next target.
            // callAiStream already announced "Thinking deeply…" if reasoning
            // was streamed, so the client saw progress, not dead dots.
            if (!content && (!tool_calls || tool_calls.length === 0)) {
              lastErr = new Error(`empty round from ${target.model}`);
              console.warn(`[ai] stream target ${target.model}: empty round (reasoning budget?) (${Date.now() - callStarted}ms) — trying next target`);
              continue;
            }
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            console.warn(`[ai] stream target ${target.model} failed: ${(err as Error).message} (${Date.now() - callStarted}ms)`);
          }
        }
        if (lastErr) {
          // A failed wrap-up is NOT a brain snag — fall through to the honest
          // exhaustion message below (the model did the research; it just
          // couldn't render the final summary this time).
          if (wrapup) break;
          throw lastErr;
        }
        if (!tool_calls || tool_calls.length === 0) {
          finalContent = content;
          answeredBy = wrapup ? "wrapup" : "ok";
          break;
        }
        messages.push({ role: "assistant", content, tool_calls });
        for (const tc of tool_calls) {
          write(sseFrame(JSON.stringify({ label: toolStatusLabel(tc.function?.name) }), "status"));
        }
        const results = await runToolCalls(tool_calls, tools);
        results.forEach((result, i) => {
          messages.push({ role: "tool", tool_call_id: tool_calls[i].id || "", content: result });
          const proposal = extractPointProposal(tool_calls[i].function?.name, result);
          if (proposal) {
            write(sseFrame(JSON.stringify({ label: "Waiting for a parent's PIN to confirm…", proposal }), "status"));
          }
        });
      }
      if (!finalContent) {
        answeredBy = "exhausted";
        finalContent = "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧";
        // Streamed clients must see exactly what gets persisted.
        write(sseFrame(JSON.stringify({ t: finalContent })));
      }
      recordChatOutcome({
        outcome: clientGone ? "client_gone" : answeredBy,
        agent: ctx.agent,
        rounds: ctx.rounds,
        ms: Date.now() - startedAt,
        brain: ctx.brain,
        targets: ctx.targets,
      });
      if (!isClem) await persistChatPair(request, message, finalContent, sessionName || "");
      write(sseFrame("[DONE]"));
    } catch (error: any) {
      console.error("Consuela stream error:", error?.message || error);
      try {
        recordChatOutcome({
          outcome: clientGone ? "client_gone" : "snag",
          agent: ctx.agent,
          rounds: ctx.rounds,
          ms: Date.now() - startedAt,
          brain: ctx.brain,
          targets: ctx.targets,
          reason: String(error?.message || error).slice(0, 200),
        });
      } catch { /* health recording must never break the stream */ }
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

/**
 * Planner mode — grounded JSON generation for the dashboard's ✨ Generate
 * buttons. Parent sessions only (buttons are adult UI); ZERO tools armed so a
 * generation can never carry a write side-effect; the daily thread is never
 * touched. Single round per attempt, target-chain fail-over inside an
 * attempt, exactly ONE repair retry when the model ignores the JSON contract,
 * then an honest {ok:false, reason}.
 */
async function handlePlanner(request: NextRequest, body: ChatRequestBody) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session?.role !== "parent") {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const intent = String(body.intent || "");
  if (!isPlannerIntent(intent)) {
    return NextResponse.json({ ok: false, reason: "unknown_intent" }, { status: 400 });
  }
  const targets = await resolveChatTargets();
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, reason: "no_provider" });
  }
  const scope: PackScope = intent.startsWith("meal")
    ? "meal"
    : intent.startsWith("task") || intent.startsWith("reward") ? "task" : "schedule";
  const pack = await loadContextPack(scope);
  const messages: ChatMessage[] = [
    { role: "system", content: plannerSystemPrompt(intent, pack) },
    { role: "user", content: plannerUserPrompt(intent, body.options || {}) },
  ];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const target of targets) {
      try {
        // No tools passed → callAi drops `tools` AND `tool_choice` from the
        // request body entirely (providers 400 on tool_choice with no set).
        const { content } = await callAi(messages, { target, maxTokens: plannerMaxTokens(intent) });
        const v = validatePlannerOutput(intent, content);
        if (v.ok) return NextResponse.json({ ok: true, intent, result: v.result });
        lastErr = new Error("invalid_model_output");
        if (attempt === 0) {
          messages.push({ role: "assistant", content });
          messages.push({ role: "user", content: "That reply was not valid JSON in the requested shape. Reply with ONLY valid JSON matching the schema. No prose." });
          break; // repair retry restarts the target chain
        }
      } catch (e) {
        // Provider errors never consume the repair attempt — the inner loop
        // just fails over to the next target.
        lastErr = e;
      }
    }
  }
  return NextResponse.json({
    ok: false,
    reason: lastErr instanceof Error && lastErr.message === "invalid_model_output"
      ? "invalid_model_output"
      : "provider_unavailable",
  });
}

export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Planner rides none of the chat machinery: dispatched BEFORE the
  // empty-message guard (it sends no `message`), before buildChatContext (it
  // has no chat tools), before the stream branch (it never streams) and it
  // never reaches persistChatPair.
  if (body.agent === "planner") return handlePlanner(request, body);

  const { message } = body;
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (body.stream === true) {
    return handleStreamedChat(request, body);
  }

  const bufferedStartedAt = Date.now();
  // Health-recorder context hoisted so failures before/inside the loop still
  // carry the REAL rounds/brain/agent instead of zeroed placeholders.
  const ctx = { agent: body.agent || "consuela", rounds: 0, brain: null as string | null, targets: 0 };
  try {
    const { isClem, targets, tools, messages, role, sessionName } = await buildChatContext(request, body);
    ctx.brain = targets.length ? `${targets[0].provider}/${targets[0].model}` : null;
    ctx.targets = targets.length;
    console.log(`[ai] agent=${body.agent || "consuela"} isClem=${isClem} brain=${targets[0]?.provider}/${targets[0]?.model} role=${role}`);

    if (targets.length === 0) {
      recordChatOutcome({ outcome: "unconfigured", agent: ctx.agent, rounds: 0, ms: Date.now() - bufferedStartedAt, brain: null, targets: 0 });
      return NextResponse.json({ content: "My brain isn't configured yet — add a provider in Settings → AI Models." });
    }

    let lastErr: unknown = null;
    const proposals: unknown[] = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      ctx.rounds = round + 1;
      // Final round = forced tool-free wrap-up (mirrors the streamed path).
      const wrapup = round === MAX_ROUNDS - 1;
      let content = "";
      let tool_calls: ToolCall[] | undefined;
      for (const target of targets) {
        const callStarted = Date.now();
        try {
          ({ content, tool_calls } = await callAi(
            wrapup ? [...messages, { role: "system", content: WRAPUP_NOTE }] : messages,
            wrapup ? { target } : { tools, toolChoice: "auto", target },
          ));
          if (wrapup) tool_calls = undefined; // a wrap-up round never executes tools
          if (!content && (!tool_calls || tool_calls.length === 0)) {
            lastErr = new Error(`empty round from ${target.model}`);
            console.warn(`[ai] target ${target.model}: empty round (reasoning budget?) (${Date.now() - callStarted}ms) — trying next target`);
            continue;
          }
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[ai] target ${target.model} failed: ${(err as Error).message} (${Date.now() - callStarted}ms)`);
        }
      }
      if (lastErr) {
        if (wrapup) break; // failed wrap-up → honest exhaustion JSON below
        throw lastErr;
      }

      if (!tool_calls || tool_calls.length === 0) {
        if (!isClem) await persistChatPair(request, message, content, sessionName || "");
        recordChatOutcome({
          outcome: wrapup ? "wrapup" : "ok",
          agent: ctx.agent,
          rounds: ctx.rounds,
          ms: Date.now() - bufferedStartedAt,
          brain: ctx.brain,
          targets: ctx.targets,
        });
        return NextResponse.json(proposals.length ? { content, proposals } : { content });
      }

      messages.push({ role: "assistant", content, tool_calls });

      const results = await runToolCalls(tool_calls, tools);
      results.forEach((result, i) => {
        messages.push({ role: "tool", tool_call_id: tool_calls[i].id || "", content: result });
        // Buffered sibling of the streamed proposal status frame (Task 15).
        const proposal = extractPointProposal(tool_calls[i].function?.name, result);
        if (proposal) proposals.push(proposal);
      });
    }

    recordChatOutcome({
      outcome: "exhausted",
      agent: ctx.agent,
      rounds: MAX_ROUNDS,
      ms: Date.now() - bufferedStartedAt,
      brain: ctx.brain,
      targets: ctx.targets,
    });
    return NextResponse.json({
      content:
        "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧",
    });
  } catch (error: any) {
    console.error("Consuela agent error:", error?.message || error);
    recordChatOutcome({
      outcome: "snag",
      agent: ctx.agent,
      rounds: ctx.rounds,
      ms: Date.now() - bufferedStartedAt,
      brain: ctx.brain,
      targets: ctx.targets,
      reason: String(error?.message || error).slice(0, 200),
    });
    return NextResponse.json({
      content:
        "Hey, I hit a snag connecting to my brain right now. Give me a moment and try again! 🔧",
    });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { buildToolsForOpenAI, getTool, type ToolHandlerContext } from "@/lib/hermes-tools";
import { db } from "@/db";
import { authorizeCurrentMemberRequest, requireLiveSession } from "@/lib/server-auth";
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
// A reasoning model re-planning after a tool error legitimately needs longer than
// a plain answer, and 60s is tight enough that the round died and the failover
// loop handed the family the "hit a snag" fallback mid-think. Only the STREAMED
// call gets the larger budget: the buffered and planner paths keep 60s, since
// holding a non-streaming call for two minutes only makes a dead provider slower
// to fail over.
const AI_STREAM_TIMEOUT_MS = 120_000;
// Comment-frame cadence for the streamed response. Kept comfortably under the
// idle window of the proxies/tunnels in front of the app, so a silent think
// never ages the connection out.
const HEARTBEAT_MS = 15_000;
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
  type?: string;
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
): Promise<{ content: string; reasoning: string; tool_calls?: ToolCall[] }> {
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
    // A non-streaming call has no delta loop to count, so this read is the only
    // way the caller can tell a round whose reasoning ate the token budget from a
    // provider that simply never answered.
    reasoning: data.choices?.[0]?.message?.reasoning_content || "",
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
  propose_reward_redemption: "Preparing that redemption…",
};
function toolStatusLabel(name?: string): string {
  return (name && TOOL_STATUS_LABELS[name]) || "Working on it…";
}

// Chat never moves points or redeems a reward. A successful proposal tool
// round yields an INERT proposal; the loop surfaces it to the client
// (streamed: extra `status` frame; buffered: top-level `proposals` array) so the
// chat page can render the PIN confirm chip. Refusals (ok:false / no
// proposal) surface nothing extra.
//
// One map is the whole registry: a tool name declares the inner
// `proposal.tool` it may produce and the label its chip frame carries, so a
// second proposal type adds a row instead of a fourth hardcoding. The label is
// what the family reads while the chip forms, so it must not name a PIN owner
// the gated route never consults: an adjustment is confirmed by a PARENT's PIN,
// a redemption by the reward OWNER's (a parent's is only additionally required
// above the parent-approval threshold), so only the adjustment row names one.
// A proposal tool NEVER writes; the PIN-gated server route is the only path that
// moves points or redeems a reward.
const PROPOSAL_TOOLS: Record<string, { expectTool: string; label: string }> = {
  propose_point_adjustment: { expectTool: "adjust_points", label: "Waiting for a parent's PIN to confirm…" },
  propose_reward_redemption: { expectTool: "redeem_reward", label: "Waiting for a PIN to confirm…" },
};
function extractProposal(name: string | undefined, result: string): { proposal: unknown; label: string } | null {
  const entry = name ? PROPOSAL_TOOLS[name] : undefined;
  if (!entry) return null;
  try {
    const p = JSON.parse(result);
    if (p?.ok === true && p.proposal?.tool === entry.expectTool && p.proposal.args) {
      return { proposal: p.proposal, label: entry.label };
    }
  } catch { /* malformed tool result — nothing to surface */ }
  return null;
}

// Several OpenAI-compatible gateways emit tool_calls deltas with no `id`, and
// an empty tool_call_id makes the NEXT round 400 — the turn dies mid-loop and
// the user watches the dots go nowhere. A provider id is returned verbatim (this
// helper only fills a gap, it never rewrites what the provider sent); the
// synthesized one only applies when there is nothing to pass through.
function toolCallIdFor(id: string | undefined, index: number): string {
  if (typeof id === "string" && id.trim()) return id;
  return `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strict OpenAI-compatible servers validate a `role:"tool"` message's
 * tool_call_id against the ids on the PRECEDING assistant entry, so the two must
 * be normalized together. This is the single place ids and the `type` beside
 * them are derived: it returns the very array that gets echoed back on the
 * assistant message, and the tool replies read their id back off it. Streamed
 * deltas carry no `type` at all, so it defaults to the only kind OpenAI defines.
 */
function normalizeToolCallIds(tool_calls: ToolCall[]): (ToolCall & { id: string; type: string })[] {
  return tool_calls.map((tc, i) => ({ ...tc, id: toolCallIdFor(tc.id, i), type: tc.type ?? "function" }));
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
    signal: AbortSignal.timeout(AI_STREAM_TIMEOUT_MS),
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
    const reasoning = data.choices?.[0]?.message?.reasoning_content || "";
    // Buffered answer — surface it downstream as one token frame so the
    // client's SSE contract holds either way. Its reasoning arrives whole, so
    // it rides one frame the same way.
    if (reasoning) write(sseFrame(JSON.stringify({ r: reasoning }), "reasoning"));
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
      // Reasoning models think out loud before answering. Forward the text so
      // the user can watch the think instead of staring at a label that never
      // changes. DISPLAY-ONLY (spec §8): it goes to the client and nowhere else
      // — never onto `content`, so the persisted answer stays the answer.
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        write(sseFrame(JSON.stringify({ r: delta.reasoning_content }), "reasoning"));
        reasoningChars += delta.reasoning_content.length;
        // The status line still replaces the dead typing dots, once per call.
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
  context: ToolHandlerContext,
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
      return await tool.handler(parseToolArgs(tc.function?.arguments), context);
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || "Tool failed" });
    }
  }));
}

/**
 * Did this tool round fail? `runToolCalls` answers a thrown handler with
 * `{"error":…}` and a call outside the session allowlist with the same shape,
 * and a handler may return its own `{"error":…}` of its own accord — so one
 * rule covers every failure the route can see. A result that is not JSON is
 * treated as a success: refusing to guess is what keeps a working tool from
 * being painted as broken.
 */
function toolResultFailed(result: string): boolean {
  try {
    return (JSON.parse(result) as any)?.error !== undefined;
  } catch {
    return false;
  }
}

interface ChatRequestBody {
  message?: string; history?: any[]; role?: string; system?: string; agent?: string; stream?: boolean;
  intent?: string; options?: any;
}

/**
 * A verified LIVE caller. `role` is read off the PocketBase row behind the
 * session — never off the cookie, whose role is a 7-day claim with no
 * revocation. `memberId`/`name` are the LIVE row's, so a thread row is
 * attributed to the member who actually exists today.
 */
interface LiveCaller {
  memberId: string;
  name: string;
  role: string;
}

/**
 * Agents that are a human-facing CONVERSATION. Everything else on this route
 * is either the planner (dispatched before this runs, parent-gated, zero
 * tools) or an internal non-conversational completion.
 */
const CONVERSATIONAL_AGENTS = new Set(["clem"]);

/**
 * The identity this request speaks with.
 *
 * `live` is the VERIFIED identity: `authorizeCurrentMemberRequest` re-read the
 * PocketBase row behind the session cookie, so `role`/`name`/`memberId` are the
 * live values and never the cookie's 7-day claim.
 *
 * `internal` marks the request as one that must not touch family data AT ALL —
 * no tool manifest is built for it, it can never arm a write tool, and it can
 * never write to the shared thread. It is set for a request that presents no
 * live identity (the anonymous completion the API_EXEMPT carve-out exists for)
 * or one that declares a conversation while its identity cannot be verified.
 */
interface ChatCaller {
  live: LiveCaller | null;
  internal: boolean;
}

/**
 * Is this request a turn in a human chat surface?
 *
 * Stated POSITIVELY, because the previous gate inferred it from an ABSENCE:
 * `persistChatPair` fired on `!isClem`, so a caller that named no agent was
 * assumed to be the family talking to Consuela. Both recipe-parse callers
 * (useRecipes.ts:188 in the browser, api/recipes/ingest/route.ts:163
 * server-side) post a bare `{message}`, satisfied `!isClem`, and landed a
 * ~3000-char parse prompt plus raw JSON in the shared `chat_messages` as chat
 * bubbles on every device.
 *
 * A conversation declares itself: `stream: true` (the SSE thread contract —
 * only `src/lib/chat-stream.ts` speaks it) or a named conversational agent
 * (`clem`, the meal sheet). A bare `{message}` with no live identity is an
 * internal completion call — the server-side recipe parse has no cookie and no
 * session, and that read is exactly what the middleware carve-out exists for.
 */
function isConversationalChat(body: ChatRequestBody): boolean {
  return (
    body.stream === true ||
    (typeof body.agent === "string" && CONVERSATIONAL_AGENTS.has(body.agent))
  );
}

/**
 * Resolve who this request speaks with.
 *
 * B — this route sits on the middleware API_EXEMPT list, and it is the family
 * thread's only WRITER, so identity is resolved here, in the route, where the
 * request body can say what kind of call it is.
 *
 * The WRITE and the TOOL SURFACE both require a verified live identity. What
 * stays open is only what the exemption exists for: the completion. A
 * conversation from an anonymous caller is answered with NO tools and NO store
 * (the signed-out Ask Consuela surface documented in DESIGN.md — "guest AI
 * still answers" — keeps working, but it can no longer reach the family's
 * pantry/grocery/leaderboard/tasks/calendar, and it can no longer put a row in
 * the shared thread as `guest`). A recipe parse with no live identity is the
 * same tool-free completion.
 *
 * A PocketBase outage is the one case that is refused outright, whatever the
 * caller: an unverifiable identity fails CLOSED instead of being treated as
 * anonymous.
 */
async function resolveChatCaller(
  request: NextRequest,
  body: ChatRequestBody,
): Promise<ChatCaller | Response> {
  const live = await authorizeCurrentMemberRequest(request);
  if (live.status === 503) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }
  if (live.ok) {
    return {
      live: {
        memberId: String(live.member?.id ?? live.session?.memberId ?? ""),
        name: String(live.member?.name ?? live.session?.name ?? ""),
        role: String(live.member?.role ?? live.session?.role ?? ""),
      },
      internal: false,
    };
  }
  return { live: null, internal: true };
}

/**
 * Shared preamble for both chat modes: live-identity-derived role, agent
 * routing, tool scoping, and the message stack. Used by the buffered POST and
 * the streamed handler so the two paths can never drift.
 *
 * An `internal` caller (see {@link resolveChatCaller}) gets no tools and can
 * never persist.
 */
async function buildChatContext(
  request: NextRequest,
  body: ChatRequestBody,
  caller: ChatCaller,
) {
  const { history = [], system, agent } = body;
  const message = body.message ?? "";
  const { live, internal } = caller;
  // MF-3 — role comes from the signed session cookie only; body.role is
  // ignored entirely (any kid could otherwise post role:"parent"). F3 — PARENT
  // ALLOWLIST (the Ledger-gate idiom): the roster's third role "pet"
  // (Rocco/Rico, default PIN 0000) is NOT an adult. Everything that isn't a
  // parent gets the kid soul and the kid tool surface exactly as child
  // sessions do today.
  //
  // C — and the parent decision itself is the LIVE row's, not the cookie's.
  // `caller` only exists because `authorizeCurrentMemberRequest` already
  // re-read that row (and refused the request outright when PocketBase could
  // not answer), so nothing here can re-promote a demoted parent: a stale
  // `role:"parent"` cookie over a live `child` row yields the kid surface, the
  // kid soul, and no house-control tools. No session → the same kid default.
  const isAdult = live?.role === "parent";
  const role = isAdult ? "parent" : "child";
  const houseControl = isAdult;
  const isClem = agent === "clem";
  // A + B — the one positive declaration that a turn belongs in the family's
  // SHARED thread: the streamed thread contract, minus the sheet, from a member
  // whose identity is VERIFIED live. A parse prompt (never streamed) and an
  // unverified caller (never a `live` identity) can neither satisfy it, so
  // neither can reach `persistChatPair` — which is what removes the `"guest"`
  // writer from the thread entirely.
  const threadTurn = body.stream === true && !isClem && live !== null;
  // Clem used to hardcode a gateway URL — now every agent rides the same
  // dashboard-owned chain (Task 4 of the 2026-09-07 brain cutover).
  const targets = await resolveChatTargets();
  // An internal completion call (no live identity — the server-side recipe
  // parse) is not a chat surface: it gets NO tool manifest at all, and the loop
  // below sends no `tools` key, so a prompt injected through a scraped recipe
  // page can neither read nor write family data.
  const tools = internal
    ? []
    : isClem
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
      ? buildKidSystemPrompt(undefined, live?.name)
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
  return {
    message,
    internal,
    threadTurn,
    isClem,
    targets,
    tools,
    messages,
    role,
    sessionName: live?.name ?? "",
    // The normalized `role` (pet folds into "child", guest has no session and
    // is non-adult) rides every tool call as the actor identity, so a task
    // command re-checks adulthood instead of trusting the allowlist.
    toolContext: {
      source: "hermes" as const,
      caller: {
        memberId: live?.memberId ?? "",
        name: live?.name ?? "Guest",
        role,
      },
    } satisfies ToolHandlerContext,
  };
}

async function handleStreamedChat(
  request: NextRequest,
  body: ChatRequestBody,
  caller: ChatCaller,
): Promise<Response> {
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
  // A provider can stay silent for the whole reasoning phase of a long think, and
  // any buffering intermediary in the path may hold frames until a buffer fills
  // (or the connection closes) — which reads as a dead stream. A comment frame
  // every 15s keeps the path warm; the client parser drops comment-only frames
  // (parseSSEFrames needs a `data:` line), so it never enters the contract.
  const heartbeat = setInterval(() => {
    if (!clientGone) write(": ping\n\n");
  }, HEARTBEAT_MS);

  (async () => {
    // Health-recorder context hoisted so the catch path records rounds/brain too.
    const ctx = { agent: body.agent || "consuela", rounds: 0, brain: null as string | null, targets: 0 };
    try {
      const { message, threadTurn, internal, targets, tools, messages, sessionName, toolContext } =
        await buildChatContext(request, body, caller);
      ctx.brain = targets.length ? `${targets[0].provider}/${targets[0].model}` : null;
      ctx.targets = targets.length;
      let finalContent = "";
      let answeredBy = "ok" as "ok" | "wrapup" | "exhausted";
      if (targets.length === 0) {
        recordChatOutcome({ outcome: "unconfigured", agent: ctx.agent, rounds: 0, ms: Date.now() - startedAt, brain: null, targets: 0 });
        write(sseFrame(JSON.stringify({ message: "My brain isn't configured yet — add a provider in Settings → AI Models." }), "error"));
        return;
      }
      // One attempt = one (round × target) provider call, and its attempt frame
      // goes out BEFORE the call: token frames are written inside callAiStream,
      // so a failed-over target's tokens are already in the client's bubble and
      // cannot be retracted — the frame is what lets the client reset, which is
      // what keeps displayed === persisted (only the answering round is stored).
      // `target` is the CHAIN INDEX, never the model: this route sits on the
      // middleware API_EXEMPT list and answers with no session at all, while the
      // model id is parent-gated everywhere else it surfaces (providers GET,
      // health ring via ctx.brain).
      for (let round = 0; round < MAX_ROUNDS; round++) {
        ctx.rounds = round + 1;
        // Final round = forced tool-free wrap-up: no tools are offered, so the
        // model must produce content from what it already gathered.
        const wrapup = round === MAX_ROUNDS - 1;
        let content = "";
        let tool_calls: ToolCall[] | undefined;
        let lastErr: unknown = null;
        for (const [targetIndex, target] of targets.entries()) {
          const callStarted = Date.now();
          try {
            write(sseFrame(JSON.stringify({ round: round + 1, target: `t${targetIndex}` }), "attempt"));
            ({ content, tool_calls } = await callAiStream(
              wrapup ? [...messages, { role: "system", content: WRAPUP_NOTE }] : messages,
              // `internal` is tool-free for its whole life (see buildChatContext)
              // — like the wrap-up round, it drops `tools` AND `tool_choice`
              // together, since some providers 400 on a tool_choice with no set.
              wrapup || internal ? { target } : { tools, target },
              write,
            ));
            if (wrapup || internal) tool_calls = undefined; // a tool-free round never executes tools
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
        const roundToolCalls = normalizeToolCallIds(tool_calls);
        messages.push({ role: "assistant", content, tool_calls: roundToolCalls });
        // Every call is announced BEFORE any of them runs (they execute
        // concurrently below), so the full list of what Consuela is reaching for
        // shows up at once instead of trickling in as each one lands.
        for (const tc of roundToolCalls) {
          write(sseFrame(JSON.stringify({ label: toolStatusLabel(tc.function?.name) }), "status"));
          write(sseFrame(JSON.stringify({ name: tc.function?.name || "tool", state: "running" }), "tool"));
        }
        const results = await runToolCalls(roundToolCalls, tools, toolContext);
        results.forEach((result, i) => {
          write(sseFrame(JSON.stringify({
            name: roundToolCalls[i].function?.name || "tool",
            state: toolResultFailed(result) ? "error" : "ok",
          }), "tool"));
          messages.push({ role: "tool", tool_call_id: roundToolCalls[i].id, content: result });
          const extracted = extractProposal(roundToolCalls[i].function?.name, result);
          if (extracted) {
            write(sseFrame(JSON.stringify({ label: extracted.label, proposal: extracted.proposal }), "status"));
          }
        });
      }
      if (!finalContent) {
        answeredBy = "exhausted";
        finalContent = "I kept needing to look things up and ran out of steps — give me a moment and try again! 🔧";
        // Streamed clients must see exactly what gets persisted — including this
        // synthesized fallback, which is written as an ordinary token frame. Its
        // own attempt frame clears the tool rounds' tokens first, so it replaces
        // them instead of being appended to them.
        write(sseFrame(JSON.stringify({ round: ctx.rounds, target: "exhausted" }), "attempt"));
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
      // The terminator goes out BEFORE the store write, so a turn is delivered to
      // the requester before it is stored. That is the whole ordering: chat-store
      // settles on its success path the moment it sees `[DONE]` and renders
      // "Stopped." only from its catch, so once the terminator is in a
      // requester's hands there is no longer a contradiction to fix — an abort
      // that arrives afterwards cannot put a stopped bubble over a row the
      // server kept. Persisting first and re-checking the signals afterwards
      // could not have closed this without a `deleteChatMessage`, which the
      // chat_messages surface does not have.
      //
      // `[DONE]` therefore means "this answer is complete and has been handed to the
      // requester", not "the row is already in PocketBase" — the two are now one
      // or two PB round trips apart. Two narrower corrections to the older,
      // stronger phrasing: a **Clem** turn (and any non-conversational internal
      // call — see `threadTurn`) stores nothing at
      // all, so for those the terminator promises delivery and nothing
      // more; and even for Consuela the promise is conditional, because any
      // client-side abort between this write and the guard still suppresses the
      // store. Nothing in the shipped client depends on the stronger reading: the
      // store's post-stream reconcile is `mergeThread`, which is add-only, and
      // the bubble is already in local state and localStorage.
      write(sseFrame("[DONE]"));
      // Stop is a promise: a requester who aborted is already looking at
      // "Stopped.", so storing the answer behind it only hands that row back on
      // the store's next reconcile and the cancelled reply reappears anyway.
      // Both signals are inferences, not a cancel the route can await —
      // `clientGone` needs a write to fail and `request.signal` needs the socket
      // to close — so a requester that stops reading while its socket stays open
      // is still missed. A cancel message the route awaits is the durable fix.
      //
      // ANY client-side abort suppresses persistence, not only a deliberate stop:
      // chat-stream.ts composes the caller's stop with AbortSignal.timeout(300_000)
      // into the one fetch signal, so a 5-minute watchdog expiry closes the same
      // socket and arrives here identically. The route cannot tell them apart (the
      // discriminator is client-side, `failError(stopSignal)`), and dropping is
      // still the lesser evil — resurrection was the bug this replaced — but it is
      // a behaviour change worth knowing, and AI_STREAM_TIMEOUT_MS(120s) widened
      // it: a streamed round now budgets 120s, so a single-target chain's worst
      // case is ~12 minutes (MAX_ROUNDS(6) × targets, each target on a fresh
      // timeout), and a failover chain crosses the cap inside ONE round
      // at 3 targets (3 × 120s > 300s) where 60s needed 6 (6 × 60s > 300s). A turn
      // the watchdog kills then reaches the family thread from no device at all —
      // the only one still holding the answer is the requester showing the offline
      // copy. The buffered and planner calls still budget AI_TIMEOUT_MS(60s).
      if (threadTurn && !clientGone && !request.signal.aborted) {
        await persistChatPair(request, message, finalContent, sessionName || "");
      }
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
      clearInterval(heartbeat);
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Buffering intermediaries must not accumulate SSE frames before
      // forwarding them.
      "X-Accel-Buffering": "no",
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
 *
 * The parent gate re-reads the LIVE PocketBase row — the same helper and the
 * same `requireLiveSession({requireRole:"parent"})` seam
 * /api/consuela/planner/apply and /api/admin/* use — so a cookie whose role
 * claim has gone stale is refused and a PocketBase outage fails closed. The
 * response keeps its `{ok:false, reason}` shape (the meal/tasks UI keys its
 * error copy off `reason`), with the honest `identity_unavailable` reason for
 * an outage so it never reads as "sign in again".
 */
async function handlePlanner(request: NextRequest, body: ChatRequestBody) {
  const live = await requireLiveSession(request, { requireRole: "parent" });
  if (!live.ok) {
    const reason = live.status === 503 ? "identity_unavailable" : "unauthorized";
    return NextResponse.json({ ok: false, reason }, { status: live.status });
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

  // B — see resolveChatCaller: the WRITE and the tool surface both require a
  // verified live identity; only the completion stays open.
  const resolved = await resolveChatCaller(request, body);
  if (resolved instanceof Response) return resolved;
  const { live: caller, internal } = resolved;

  if (body.stream === true) {
    return handleStreamedChat(request, body, { live: caller, internal });
  }

  const bufferedStartedAt = Date.now();
  // Health-recorder context hoisted so failures before/inside the loop still
  // carry the REAL rounds/brain/agent instead of zeroed placeholders.
  const ctx = { agent: body.agent || "consuela", rounds: 0, brain: null as string | null, targets: 0 };
  try {
    const { isClem, internal: isInternal, threadTurn, targets, tools, messages, role, sessionName, toolContext } =
      await buildChatContext(request, body, { live: caller, internal });
    ctx.brain = targets.length ? `${targets[0].provider}/${targets[0].model}` : null;
    ctx.targets = targets.length;
    console.log(`[ai] agent=${body.agent || "consuela"} isClem=${isClem} internal=${isInternal} brain=${targets[0]?.provider}/${targets[0]?.model} role=${role}`);

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
      // An internal, non-conversational call (the recipe parse) is tool-free
      // for its WHOLE life — it arms no manifest and offers no `tools` key to
      // the provider, exactly like the planner. No tool round can follow, so
      // round 0 answers and the loop ends.
      const toolFree = wrapup || isInternal;
      let content = "";
      let tool_calls: ToolCall[] | undefined;
      for (const target of targets) {
        const callStarted = Date.now();
        try {
          ({ content, tool_calls } = await callAi(
            wrapup ? [...messages, { role: "system", content: WRAPUP_NOTE }] : messages,
            toolFree ? { target } : { tools, toolChoice: "auto", target },
          ));
          if (toolFree) tool_calls = undefined; // a tool-free round never executes tools
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
        // A — the positive thread-turn intent, not `!isClem`. Neither a Clem
        // sheet turn, nor an internal completion, is a turn in the family's
        // shared thread, so neither may write a row into it.
        if (threadTurn) await persistChatPair(request, message, content, sessionName || "");
        recordChatOutcome({
          outcome: wrapup ? "wrapup" : "ok",
          agent: ctx.agent,
          rounds: ctx.rounds,
          ms: Date.now() - bufferedStartedAt,
          brain: ctx.brain,
          targets: ctx.targets,
        });
        // The buffered body is `content` plus `proposals` — the keys
        // `chat-stream.ts` reads on this path, and the only ones it reads. A
        // reasoning round answers the same shape a non-reasoning one does: the
        // transcript reaches the client as `reasoning` FRAMES on the streamed
        // path (`callAiStream`, which emits one whole frame for a buffered
        // provider), never as a body key.
        return NextResponse.json({
          content,
          ...(proposals.length ? { proposals } : {}),
        });
      }

      const roundToolCalls = normalizeToolCallIds(tool_calls);
      messages.push({ role: "assistant", content, tool_calls: roundToolCalls });

      const results = await runToolCalls(roundToolCalls, tools, toolContext);
      results.forEach((result, i) => {
        messages.push({ role: "tool", tool_call_id: roundToolCalls[i].id, content: result });
        // Buffered sibling of the streamed proposal status frame (Task 15).
        const extracted = extractProposal(roundToolCalls[i].function?.name, result);
        if (extracted) proposals.push(extracted.proposal);
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
      // A turn that ran out of rounds can still have earned a proposal on the
      // way there; dropping it here threw away a PIN chip the family was shown.
      ...(proposals.length ? { proposals } : {}),
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

import { NextRequest, NextResponse } from "next/server";
import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";
import { getServiceConfig } from "@/lib/services/config";
import { db } from "@/db";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildClemSystemPrompt, buildConsuelaSystemPrompt, HOUSE_CONTROL_PROMPT_ADDENDUM } from "@/lib/consuela-prompts";

export const dynamic = "force-dynamic";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

async function persistChatPair(request: NextRequest, userMessage: string, assistantReply: string) {
  try {
    // I1 — don't persist empty/fallback replies: they're thread spam and give
    // the daily thread nothing useful for later rounds.
    const reply = String(assistantReply || "").trim();
    if (!reply || reply === "I processed that.") return;
    const userId = request.cookies.get("x-consuela-user")?.value || "guest";
    const threadId = todayISO();
    // Explicit createdAt keeps the user row strictly before the assistant row
    // in the createdAt-ascending thread sort even when both land in the same ms.
    const userAt = new Date();
    const assistantAt = new Date(userAt.getTime() + 1);
    await Promise.all([
      db.insertChatMessage({ userId, role: "user", content: userMessage, source: "dashboard", threadId, createdAt: userAt.toISOString() }),
      db.insertChatMessage({ userId: "consuela", role: "assistant", content: reply, source: "dashboard", threadId, createdAt: assistantAt.toISOString() }),
    ]);
  } catch (e: any) {
    console.error("Failed to persist chat messages:", e?.message || e);
  }
}

// Registry override → env → code fallback. The resolved endpoint is cached
// in-process for 10 minutes — it changes rarely, and two PB reads per chat
// message were pure latency. Settings → Services "Test" reads fresh config
// independently, so a key edit is verified immediately even while cached.
const HERMES_CONFIG_TTL_MS = 10 * 60 * 1000;
const HERMES_TIMEOUT_MS = 60_000;

let hermesConfigCache: { value: { url: string; key: string | null }; expiresAt: number } | null = null;

// Flipped to false the first time Hermes answers a stream:true request with a
// buffered JSON payload — the endpoint doesn't do SSE, so stop paying the
// failed attempt on every round until the process restarts.
let hermesStreamingSupported = true;

/** Test-only: clears the module-scope caches between vitest cases. */
export function resetHermesChatForTests() {
  hermesConfigCache = null;
  hermesStreamingSupported = true;
}

async function resolveHermes(): Promise<{ url: string; key: string | null }> {
  if (hermesConfigCache && hermesConfigCache.expiresAt > Date.now()) return hermesConfigCache.value;
  const [storedUrl, storedKey] = await Promise.all([
    getServiceConfig("hermes", "HERMES_API_URL"),
    getServiceConfig("hermes", "HERMES_API_KEY"),
  ]);
  const value = {
    url: storedUrl || process.env.HERMES_API_URL || "http://hermes-agent-2:8643",
    key: storedKey ?? process.env.HERMES_API_KEY ?? null,
  };
  hermesConfigCache = { value, expiresAt: Date.now() + HERMES_CONFIG_TTL_MS };
  return value;
}
const HERMES_MODEL = "consuela";

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

async function callHermes(
  messages: ChatMessage[],
  opts: { maxTokens?: number; tools?: ReturnType<typeof buildToolsForOpenAI>; toolChoice?: "auto" | "none"; hermes?: { url: string; key: string | null } } = {},
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const hermes = opts.hermes ?? (await resolveHermes());
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hermes.key) headers.Authorization = `Bearer ${hermes.key}`;
  const res = await fetch(`${hermes.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      tools: opts.tools,
      tool_choice: opts.toolChoice ?? "auto",
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Hermes ${res.status}: ${err || res.statusText}`);
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
};
function toolStatusLabel(name?: string): string {
  return (name && TOOL_STATUS_LABELS[name]) || "Working on it…";
}

/**
 * One streaming Hermes round. Content deltas are forwarded to `write` live;
 * tool-call deltas are accumulated and returned for the loop to execute.
 * Falls back to a buffered read when Hermes doesn't honor stream:true
 * (and remembers, so later rounds skip the attempt until process restart).
 */
async function callHermesStream(
  messages: ChatMessage[],
  opts: { tools?: ReturnType<typeof buildToolsForOpenAI>; hermes: { url: string; key: string | null } },
  write: (frame: string) => void,
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.hermes.key) headers.Authorization = `Bearer ${opts.hermes.key}`;
  const wantStream = hermesStreamingSupported;
  const res = await fetch(`${opts.hermes.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
    body: JSON.stringify({
      model: HERMES_MODEL,
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
    throw new Error(`Hermes ${res.status}: ${err || res.statusText}`);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!wantStream || !ctype.includes("text/event-stream") || !res.body) {
    if (wantStream && !ctype.includes("text/event-stream")) hermesStreamingSupported = false;
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
    const tool = name ? getTool(name) : undefined;
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
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const role = session?.role ?? "child";
  const houseControl = role !== "child";
  const isClem = agent === "clem";
  // Clem must always hit the Consuela gateway at 8643 — never finance (8642 is Alex).
  // Hardcode to avoid any PB/env override that might point Clem at finance.
  const hermes = isClem
    ? { url: "http://hermes-agent-2:8643", key: (await resolveHermes()).key }
    : await resolveHermes();
  const tools = isClem
    ? buildToolsForOpenAI({ houseControl: false }).filter((t) => CLEM_TOOLS.includes(t.function.name))
    : buildToolsForOpenAI({ houseControl });
  const recentHistory = (history || [])
    .slice(-6)
    .filter((h: any) => h && typeof h.content === "string" && h.content.trim())
    .map((h: any) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    }));
  const baseSystem = isClem
    ? buildClemSystemPrompt()
    : buildConsuelaSystemPrompt() + (houseControl ? HOUSE_CONTROL_PROMPT_ADDENDUM : "");
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
  return { message, isClem, hermes, tools, messages, role };
}

async function handleStreamedChat(request: NextRequest, body: ChatRequestBody): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (frame: string) => { writer.write(enc.encode(frame)).catch(() => { /* client gone */ }); };

  (async () => {
    try {
      const { message, isClem, hermes, tools, messages } = await buildChatContext(request, body);
      let finalContent = "";
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { content, tool_calls } = await callHermesStream(messages, { tools, hermes }, write);
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
      if (!isClem) await persistChatPair(request, message, finalContent);
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
    const { isClem, hermes, tools, messages, role } = await buildChatContext(request, body);
    console.log(`[hermes] agent=${body.agent || "consuela"} isClem=${isClem} url=${hermes.url} model=${HERMES_MODEL} role=${role}`);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { content, tool_calls } = await callHermes(messages, { tools, toolChoice: "auto", hermes });

      if (!tool_calls || tool_calls.length === 0) {
        if (!isClem) await persistChatPair(request, message, content);
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

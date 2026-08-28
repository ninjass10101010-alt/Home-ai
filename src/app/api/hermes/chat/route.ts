import { NextRequest, NextResponse } from "next/server";
import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";
import { getServiceConfig } from "@/lib/services/config";
import { db } from "@/db";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

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
    await db.insertChatMessage({ userId, role: "user", content: userMessage, source: "dashboard", threadId });
    await db.insertChatMessage({ userId: "consuela", role: "assistant", content: reply, source: "dashboard", threadId });
  } catch (e: any) {
    console.error("Failed to persist chat messages:", e?.message || e);
  }
}

// Registry override → env → code fallback. The old hardcoded key default is
// gone; unset keys simply send no Authorization header.
async function resolveHermes(): Promise<{ url: string; key: string | null }> {
  const url =
    (await getServiceConfig("hermes", "HERMES_API_URL")) ||
    process.env.HERMES_URL ||
    process.env.HERMES_API_URL ||
    "http://hermes-agent-2:8643";
  const key = (await getServiceConfig("hermes", "HERMES_API_KEY")) ?? process.env.HERMES_API_KEY ?? null;
  return { url, key };
}
const HERMES_MODEL = "consuela";
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

const SYSTEM_PROMPT = `You are Consuela, the Garcia family's AI assistant. You have access to the family dashboard through tools.

Family members: Rebecca (Mom 🐱), Jeffery (Dad 👨), Emily (👧14), Bailey (👧12), Jasmine (👧10), Aurora (👧7), Caspian (🧒5), Rocco (🐶), Rico (🐩).

Admin capabilities — you can also manage the dashboard itself:
- check_for_update: Check if new code is available on GitHub
- trigger_update: Pull latest code and rebuild the dashboard container
- get_container_status: Check if Docker containers (dashboard, PocketBase, Hermes) are running
- restart_container: Restart a container if unhealthy
- check_pocketbase: Verify the database is healthy and connected

Rules:
1. When asking about events, tasks, meals, recipes, grocery, or pantry — ALWAYS call a tool first.
2. Never make up data. If you need to know something about the dashboard, use a tool.
3. Use the user's message to determine which tool to call and what arguments to pass.
4. For admin actions, confirm with the user before triggering updates or restarts. Use check_for_update or get_container_status first.
5. If the user references a previous action (e.g. 'did you add milk?'), use a read tool to check current state rather than assuming.`;

const HOUSE_CONTROL_PROMPT_ADDENDUM = `

House control — you can also control smart home devices:
- ha_list_devices: List controllable lights, switches, scenes, thermostats, media players, and vacuums.
- ha_control_device: Control a device by entity_id and action (toggle/turn_on/turn_off, set_temperature, set_hvac_mode, volume_set, media_play/pause, vacuum start/pause/stop/return_to_base).
Never control devices unless the user clearly asks. Alarms and locks are permanently excluded for safety.`;

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
  opts: { maxTokens?: number; tools?: ReturnType<typeof buildToolsForOpenAI>; toolChoice?: "auto" | "none" } = {},
): Promise<{ content: string; tool_calls?: ToolCall[] }> {
  const hermes = await resolveHermes();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hermes.key) headers.Authorization = `Bearer ${hermes.key}`;
  const res = await fetch(`${hermes.url}/v1/chat/completions`, {
    method: "POST",
    headers,
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

export async function POST(request: NextRequest) {
  let body: { message?: string; history?: any[]; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  // MF-3 — role comes from the signed session cookie only; body.role is
  // ignored entirely (any kid could otherwise post role:"parent"). No valid
  // session → child-role default: no house-control tools.
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const role = session?.role ?? "child";
  const houseControl = role !== "child";

  try {
    const tools = buildToolsForOpenAI({ houseControl });
    const recentHistory = (history || [])
      .slice(-6)
      .filter((h: any) => h && typeof h.content === "string" && h.content.trim())
      .map((h: any) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      }));

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT + (houseControl ? HOUSE_CONTROL_PROMPT_ADDENDUM : "") },
      ...recentHistory,
      { role: "user", content: message },
    ];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { content, tool_calls } = await callHermes(messages, { tools, toolChoice: "auto" });

      if (!tool_calls || tool_calls.length === 0) {
        await persistChatPair(request, message, content);
        return NextResponse.json({ content });
      }

      messages.push({ role: "assistant", content, tool_calls });

      for (const tc of tool_calls) {
        const name = tc.function?.name;
        const tool = name ? getTool(name) : undefined;

        let result: string;
        if (!name || !tool) {
          const available = tools.map((t) => t.function.name).join(", ");
          result = JSON.stringify({
            error: `Unknown tool: ${name ?? "<missing name>"}. Available: ${available}`,
          });
        } else {
          try {
            result = await tool.handler(parseToolArgs(tc.function?.arguments));
          } catch (e: any) {
            result = JSON.stringify({ error: e?.message || "Tool failed" });
          }
        }

        messages.push({ role: "tool", tool_call_id: tc.id || "", content: result });
      }
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

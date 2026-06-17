import { NextRequest, NextResponse } from "next/server";
import {
  buildToolsForOpenAI,
  getTool,
} from "@/lib/hermes-tools";

export const dynamic = "force-dynamic";

const HERMES_API_KEY = process.env.HERMES_API_KEY || "consuela-api-key-2026";
const HERMES_URL =
  process.env.HERMES_URL || process.env.HERMES_API_URL || "http://hermes-agent-2:8642";
const HERMES_MODEL = "consuela";
const MAX_ROUNDS = 2;

function toolListForPrompt(): string {
  return buildToolsForOpenAI()
    .map((t) => {
      const props = t.function.parameters.properties || {};
      const argStr = Object.entries(props)
        .map(([k, v]) => `"${k}" (${(v as any).type}, ${(v as any).description})`)
        .join(", ");
      const required = t.function.parameters.required || [];
      return `- ${t.function.name}: ${t.function.description}${argStr ? `\n  Args: ${argStr}` : ""}${required.length ? `\n  Required: ${required.join(", ")}` : ""}`;
    })
    .join("\n");
}

const FIRST_ROUND_PROMPT = `You are Consuela, the Garcia family's AI assistant. You have access to the family dashboard through tools.

IMPORTANT — For this message, you MUST decide whether you need to call a tool. If you do, respond with ONLY a JSON object in this format:

{
  "tool_call": "name_of_tool",
  "tool_args": { "arg_name": "value" }
}

Available tools:
${toolListForPrompt()}

If NO tool is needed (greetings, general chat, etc.), respond with:
{
  "tool_call": null,
  "content": "your friendly reply"
}

Family members: Rebecca (Mom 🐱), Jeffery (Dad 👨), Emily (👧14), Bailey (👧12), Jasmine (👧10), Aurora (👧7), Caspian (🧒5), Rocco (🐶), Rico (🐩).

Rules:
1. When asking about events, tasks, meals, recipes, grocery, or pantry — ALWAYS call the tool first.
2. Never make up data. If you need to know something about the dashboard, use a tool.
3. Use the user's message to determine which tool to call and what arguments to pass.
4. Return ONLY JSON. No markdown wrapping, no explanations outside the JSON.`;

const FINAL_ROUND_PROMPT = `You are Consuela, the Garcia family's AI assistant. You just received tool results from the dashboard. Use these results to answer the user's question naturally.

The user's original message was: "{originalMessage}"

Tool called: {toolName}
Tool results:
{toolResults}

Respond with ONLY a natural, friendly message. Be specific — mention actual names, times, and details from the results. Use emojis naturally. Keep it warm and family-appropriate.

Family: Rebecca (Mom 🐱), Jeff (Dad 👨), Emily (👧14), Bailey (👧12), Jasmine (👧10), Aurora (👧7), Caspian (🧒5), Rocco (🐶), Rico (🐩).`;

const CASUAL_PROMPT = `You are Consuela, the Garcia family's AI assistant. Respond to the user's message naturally. Be warm, friendly, and family-appropriate. Use emojis sparingly. Keep responses concise.

Family: Rebecca (Mom 🐱), Jeff (Dad 👨), Emily (👧14), Bailey (👧12), Jasmine (👧10), Aurora (👧7), Caspian (🧒5), Rocco (🐶 Frenchie), Rico (🐩 Poodle).`;

async function callHermes(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1024,
): Promise<string> {
  const res = await fetch(`${HERMES_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HERMES_API_KEY}`,
    },
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Hermes ${res.status}: ${err || res.statusText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function extractJSON(raw: string): any | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: { message?: string; history?: any[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    let recentHistory = [...(history || [])].slice(-6);
    const historyBlock = recentHistory.length > 0
      ? `\n\nRecent conversation:\n${recentHistory.map((h: any) => `${h.role}: ${h.content}`).join("\n")}`
      : "";

    const round1Messages = [
      {
        role: "system",
        content: FIRST_ROUND_PROMPT.replace(/\{toolList\}/, toolListForPrompt()),
      },
      {
        role: "user",
        content: `User message: "${message}"${historyBlock}\n\nBased on this message, do you need to call a tool? Respond with JSON only.`,
      },
    ];

    const round1Response = await callHermes(round1Messages, 300);
    const parsed = extractJSON(round1Response);

    if (!parsed || (!parsed.tool_call && !parsed.content)) {
      const fallback = await callHermes([
        { role: "system", content: CASUAL_PROMPT },
        { role: "user", content: message },
      ], 500);
      return NextResponse.json({ content: fallback });
    }

    if (!parsed.tool_call) {
      return NextResponse.json({ content: parsed.content || round1Response });
    }

    const tool = getTool(parsed.tool_call);
    let toolResult: string;
    if (tool) {
      try {
        toolResult = await tool.handler(parsed.tool_args || {});
      } catch (e: any) {
        toolResult = JSON.stringify({ error: e?.message || "Tool failed" });
      }
    } else {
      toolResult = JSON.stringify({
        error: `Unknown tool: ${parsed.tool_call}. Available: ${buildToolsForOpenAI().map((t) => t.function.name).join(", ")}`,
      });
    }

    const finalPrompt = FINAL_ROUND_PROMPT
      .replace("{originalMessage}", message)
      .replace("{toolName}", parsed.tool_call)
      .replace("{toolResults}", toolResult);

    const round2Messages = [
      { role: "system", content: finalPrompt },
      { role: "user", content: message },
    ];

    const finalResponse = await callHermes(round2Messages, 800);

    return NextResponse.json({ content: finalResponse });
  } catch (error: any) {
    console.error("Consuela agent error:", error?.message || error);
    return NextResponse.json({
      content:
        "Hey, I hit a snag connecting to my brain right now. Give me a moment and try again! 🔧",
    });
  }
}

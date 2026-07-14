import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HERMES_API_URL = process.env.HERMES_API_URL || "http://hermes-agent-2:8642/v1";
const HERMES_API_KEY = process.env.HERMES_API_KEY || "consuela-api-key-2026";

const AVAILABLE_ACTIONS = [
  { type: "add_event", desc: "Add a calendar event", data: { title: "string", time: "string", member: "string", emoji: "string", date: "string" } },
  { type: "remove_event", desc: "Remove a calendar event", data: { title: "string" } },
  { type: "add_task", desc: "Add a chore/task", data: { title: "string", assignedTo: "string", points: "number", emoji: "string" } },
  { type: "complete_task", desc: "Mark a task done", data: { title: "string" } },
  { type: "clear_leaderboard", desc: "Reset ALL task points to zero for everyone", data: {} },
  { type: "add_meal", desc: "Add a meal to the plan", data: { time: "string", name: "string", emoji: "string", day: "string" } },
  { type: "remove_meal", desc: "Remove a meal", data: { name: "string" } },
  { type: "update_grocery", desc: "Add items to the grocery list", data: { items: ["item1", "item2"] } },
  { type: "update_pantry", desc: "Add items to the pantry", data: { items: ["item1", "item2"] } },
  { type: "send_message", desc: "Notify a family member", data: { to: "string", message: "string" } },
];

const SYSTEM_PROMPT = `You are Consuela, the Garcia family AI assistant in their family dashboard.

IMPORTANT — You MUST return a JSON response with this EXACT format:
{
  "content": "your friendly reply here",
  "actions": []
}

When the user asks you to DO something (add, remove, clear, update, complete), you MUST include the matching action object in the "actions" array with the correct "type" and "data" fields.

Available actions:
${AVAILABLE_ACTIONS.map(a => `- "${a.type}": ${a.desc}`).join("\n")}

CRITICAL: If the user asks to make a change, you MUST include the action. Never just say you did something — actually do it by including the action.
Always return valid JSON only. No markdown wrapping, no extra text. JSON only.

Family members: Jeff (Dad), Rebecca (Mom), Emily (14), Bailey (12), Jasmine (10), Aurora (7), Caspian (5), Rocco (dog Frenchie), Rico (dog Poodle).`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [], context } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: context ? `${message}\n\nContext: ${context}` : message },
    ];

    // Route through Hermes API server (OpenAI-compatible)
    const response = await fetch(`${HERMES_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HERMES_API_KEY}`,
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Hermes API error:", response.status, errText);
      return NextResponse.json({
        content: "Hmm, I hit a snag connecting to my brain. Try again in a moment!",
      });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    let parsed: any = null;
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {}
    }

    if (parsed && parsed.content) {
      return NextResponse.json({
        content: parsed.content,
        actions: parsed.actions || [],
      });
    }

    return NextResponse.json({ content: rawContent, actions: [] });
  } catch (error) {
    console.error("Consuela API error:", error);
    return NextResponse.json({
      content: "Sorry, I am having trouble connecting. Try again in a moment!",
    });
  }
}

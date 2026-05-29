import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = "openrouter/free";

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

const SYSTEM_PROMPT = `You are Consuela, the Garcia family's AI assistant in their family dashboard.

IMPORTANT — You MUST return a JSON response with this EXACT format:
{
  "content": "your friendly reply here",
  "actions": []
}

When the user asks you to DO something (add, remove, clear, update, complete), you MUST include the matching action object in the "actions" array with the correct "type" and "data" fields.

Available actions:
${AVAILABLE_ACTIONS.map(a => `- "${a.type}": ${a.desc}`).join("\n")}

EXAMPLE — User says "clear the leaderboard":
{
  "content": "Done! The leaderboard has been cleared. Everyone starts fresh! 🌟",
  "actions": [{"type": "clear_leaderboard", "title": "Clear Leaderboard", "data": {}}]
}

EXAMPLE — User says "add a task for Emily to walk Rocco for 10 points":
{
  "content": "Added! Emily now has a task to walk Rocco for 10 points 🐶",
  "actions": [{"type": "add_task", "title": "Add Task", "data": {"title": "Walk Rocco", "assignedTo": "Emily", "points": 10, "emoji": "🐶"}}]
}

CRITICAL: If the user asks to make a change, you MUST include the action. Never just say you did something — actually do it by including the action.
Always return valid JSON only. No markdown wrapping, no extra text. JSON only.

Family members: Jeff (Dad 👨), Rebecca (Mom 🐱), Emily (👧, 14), Bailey (👧, 12), Jasmine (👧, 10), Aurora (👧, 7), Caspian (🧒, 5), Rocco (🐶 Frenchie), Rico (🐩 Poodle).`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [], context } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({
        content: "Hey! 👋 I need an API key to work. Let Dad know to set one up in the .env.local file.",
      });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: context ? `${message}\n\nContext: ${context}` : message },
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://consuela.family",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", response.status, errText);
      return NextResponse.json({
        content: "Hmm, I hit a snag connecting to my brain. Try again in a moment! 🤔",
      });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    // Try to parse JSON from the response — the AI might wrap it in markdown
    let parsed: any = null;
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Not valid JSON, use raw content
      }
    }

    if (parsed && parsed.content) {
      return NextResponse.json({
        content: parsed.content,
        actions: parsed.actions || [],
      });
    }

    // Fallback: return raw content
    return NextResponse.json({ content: rawContent, actions: [] });
  } catch (error) {
    console.error("Consuela API error:", error);
    return NextResponse.json({
      content: "Sorry, I'm having trouble connecting. Try again in a moment! 🔧",
    });
  }
}
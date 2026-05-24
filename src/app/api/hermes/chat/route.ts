import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DROGON_API = process.env.DROGON_API_URL || "http://localhost:6789/chat";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const response = await fetch(DROGON_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: history || [] }),
    });

    const data = await response.json();

    // Hermes API returns {content}, passthrough
    return NextResponse.json(data);
  } catch (error) {
    console.error("Drogon API error:", error);
    return NextResponse.json({
      content: "Sorry, I'm having trouble connecting to my brain. Try again in a moment.",
    });
  }
}

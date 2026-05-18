import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/free-communication";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chatId, message } = body;

    if (!chatId || !message) {
      return NextResponse.json({ error: "chatId and message are required" }, { status: 400 });
    }

    const result = await sendTelegramMessage(chatId, message);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Telegram API error:", error);
    return NextResponse.json({ error: "Failed to send Telegram message" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { sendHANotification } from "@/lib/ha/notify";
import { sendTelegramMessage } from "@/lib/free-communication";

// NOTE (accepted risk): unauthenticated by design — LAN-only app, see
// call-service/route.ts for the fuller note.

const TEST_TITLE = "🔔 Test from Consuela";
const TEST_MESSAGE = "This is a notification test from your family dashboard 🏠";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { target, channel } = (body ?? {}) as { target?: string; channel?: string };

  if (channel === "telegram") {
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!chatId) {
      return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 400 });
    }
    try {
      await sendTelegramMessage(chatId, `${TEST_TITLE}\n${TEST_MESSAGE}`);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }
  }

  if (typeof target !== "string" || target.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    await sendHANotification(target, TEST_TITLE, TEST_MESSAGE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

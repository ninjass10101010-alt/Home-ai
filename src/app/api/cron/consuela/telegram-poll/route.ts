// Telegram mirror poller cron route (host crontab: */30 * * * *).
//
// Polls the Consuela Mirror bot's getUpdates feed and mirrors family-group text
// messages into the daily chat_messages thread (source: "telegram").
//
// Setup still pending (user action): create the "Consuela Mirror" bot via
// @BotFather, add it to the family Telegram group as a non-admin member, and set
// TELEGRAM_MIRROR_BOT_TOKEN (currently unset in .env.example / .env.integration).
// Until then this route returns { ok: false, reason: "no_token" }.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pollTelegramUpdates, type TgUpdate } from "@/lib/telegram/get-updates";

export const dynamic = "force-dynamic";

const STATE_KEY = "last_telegram_update_id";

function dateISO(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().split("T")[0];
}

export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.TELEGRAM_MIRROR_BOT_TOKEN) {
    return NextResponse.json({ ok: false, reason: "no_token" });
  }

  const lastUpdateId = (await db.getState(STATE_KEY)) as number | null;

  let updates: TgUpdate[];
  try {
    updates = await pollTelegramUpdates(lastUpdateId ?? undefined);
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      reason: "telegram_error",
      error: String(err?.message || err),
    });
  }

  let processed = 0;
  let maxId = lastUpdateId ?? 0;
  for (const update of updates) {
    if (update.update_id <= maxId) continue;
    maxId = Math.max(maxId, update.update_id);
    const msg = update.message;
    if (!msg || !msg.text || msg.from?.is_bot) continue;
    await db.insertChatMessage({
      userId: msg.from?.first_name || "Telegram",
      role: "user",
      content: msg.text,
      source: "telegram",
      threadId: dateISO(msg.date),
    });
    processed++;
  }

  if (maxId !== (lastUpdateId ?? 0)) {
    await db.setState(STATE_KEY, maxId);
  }

  return NextResponse.json({ ok: true, processed, lastUpdateId: maxId });
}

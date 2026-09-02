// Telegram mirror poller cron route (host crontab: */5 * * * *).
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
import { pollTelegramUpdates, sanitizeTelegramError, type TgUpdate } from "@/lib/telegram/get-updates";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const STATE_KEY = "last_telegram_update_id";

function dateISO(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().split("T")[0];
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
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
    const message = sanitizeTelegramError(String(err?.message || err));
    // I2 — 429/5xx: back off, do NOT advance lastUpdateId, so the next cron
    // tick retries the same window.
    if (message.includes("429")) {
      console.log("[telegram-poll] rate-limited, backing off until next cron tick");
      return NextResponse.json({ ok: false, reason: "rate_limited" });
    }
    return NextResponse.json({
      ok: false,
      reason: "telegram_error",
      error: message,
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
      // I3 — use the Telegram send time, not the poll time.
      createdAt: new Date(msg.date * 1000).toISOString(),
    });
    processed++;
  }

  if (maxId !== (lastUpdateId ?? 0)) {
    // I6 — compare-and-set: only advance if no concurrent poll already moved
    // the offset further. A lost update here is expected under concurrency and
    // is retried on the next cron tick.
    const advanced = await db.setState(STATE_KEY, maxId, lastUpdateId ?? null);
    if (!advanced) {
      return NextResponse.json({ ok: false, reason: "state_conflict" });
    }
  }

  return NextResponse.json({ ok: true, processed, lastUpdateId: maxId });
}

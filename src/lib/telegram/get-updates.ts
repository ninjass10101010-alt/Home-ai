export interface TgMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

// L10 — redact the bot token from any error message that embeds the fetch URL
// (fetch AggregateErrors include the URL, which contains the token). Shared by
// the poller and the cron route's error response.
export function sanitizeTelegramError(message: string): string {
  return String(message).replace(
    /https:\/\/api\.telegram\.org\/bot\S+/g,
    "<redacted telegram url>"
  );
}

const POLL_TIMEOUT_MS = 30_000;

export async function pollTelegramUpdates(lastUpdateId?: number): Promise<TgUpdate[]> {
  const token = process.env.TELEGRAM_MIRROR_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_MIRROR_BOT_TOKEN missing");
  const offset = lastUpdateId ? lastUpdateId + 1 : "";
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    throw new Error(`Telegram HTTP ${r.status}`);
  }
  const data = await r.json();
  if (!data.ok) {
    throw new Error(`Telegram getUpdates failed: ${data.description || data.error_code || "unknown error"}`);
  }
  return data.result ?? [];
}

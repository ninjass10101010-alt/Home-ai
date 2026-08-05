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

export async function pollTelegramUpdates(lastUpdateId?: number): Promise<TgUpdate[]> {
  const token = process.env.TELEGRAM_MIRROR_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_MIRROR_BOT_TOKEN missing");
  const offset = lastUpdateId ? lastUpdateId + 1 : "";
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`;
  const r = await fetch(url);
  const data = await r.json();
  if (!data.ok) {
    throw new Error(`Telegram getUpdates failed: ${data.description || data.error_code || "unknown error"}`);
  }
  return data.result ?? [];
}

import { getHAWebSocketClient } from "./websocket-client";
import { sendTelegramMessage } from "@/lib/free-communication";
import { withAdmin } from "@/lib/pb-auth";

/** Entities from the live sync snapshot that are HA notification targets. */
export function listHANotifyTargets(states: Array<{ entity_id: string }>): string[] {
  return states
    .map((s) => s.entity_id)
    .filter((id) => id.startsWith("notify."))
    .sort();
}

function serviceFor(target: string): string {
  return target.startsWith("notify.") ? target.slice("notify.".length) : target;
}

/** Push one notification to a single HA companion-app target. */
export async function sendHANotification(
  target: string,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  await (await getHAWebSocketClient()).callService("notify", serviceFor(target), {
    title,
    message,
    ...data,
  });
}

interface NotifyChannelResult {
  sent: number;
  failed: number;
  notes: string[];
}

async function fetchEnabledTargets(): Promise<Array<{ target: string; enabled: boolean }>> {
  const rows = (await withAdmin(async (pb) =>
    pb.collection("ha_notify_config").getFullList()
  )) as Array<{ target: string; enabled: boolean }>;
  return rows.filter((r) => r.enabled === true);
}

/** Fan an alert out to every enabled channel (HA targets + Telegram).
 * One channel failing never blocks the others and never throws. */
export async function broadcastHouseAlert(title: string, message: string): Promise<{
  sent: number;
  failed: number;
  notes: string[];
}> {
  const result: NotifyChannelResult = { sent: 0, failed: 0, notes: [] };

  let configRows: Array<{ target: string; enabled: boolean }> = [];
  try {
    configRows = await fetchEnabledTargets();
  } catch (err) {
    result.notes.push(`config read failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const row of configRows) {
    if (!row.enabled) continue;
    try {
      await sendHANotification(row.target, title, message);
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.notes.push(`${row.target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const telegramChatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (telegramChatId) {
    try {
      // sendTelegramMessage reports failures as {success:false} rather than
      // throwing — a false "delivered" on the emergency path is dangerous,
      // so the result must be checked, not assumed.
      const tg = await sendTelegramMessage(telegramChatId, `${title}\n${message}`);
      if (tg?.success === true) {
        result.sent += 1;
      } else {
        result.failed += 1;
        const detail = tg && "error" in tg ? String(tg.error) : "unknown error";
        result.notes.push(`telegram: ${detail}`);
      }
    } catch (err) {
      result.failed += 1;
      result.notes.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

import { NextResponse } from "next/server";
import { fetchHADeviceStates } from "@/lib/ha/rest-client";
import { listHANotifyTargets } from "@/lib/ha/notify";
import { withAdmin } from "@/lib/pb-auth";

// NOTE (accepted risk): unauthenticated by design — LAN-only app, see
// call-service/route.ts for the fuller note.

interface NotifyConfigRow {
  target: string;
  enabled: boolean;
}

export async function GET() {
  let liveTargets: string[] = [];
  try {
    liveTargets = listHANotifyTargets(await fetchHADeviceStates());
  } catch {
    // HA down — fall back to configured rows only.
  }

  let configRows: NotifyConfigRow[] = [];
  let pbError = false;
  try {
    configRows = (await withAdmin(async (pb) =>
      pb.collection("ha_notify_config").getFullList()
    )) as NotifyConfigRow[];
  } catch {
    pbError = true;
  }

  const enabledByTarget = new Map(configRows.map((r) => [r.target, r.enabled === true]));
  const targets = Array.from(new Set([...liveTargets, ...configRows.map((r) => r.target)]))
    .sort()
    .map((target) => ({
      target,
      enabled: enabledByTarget.get(target) ?? false,
    }));

  return NextResponse.json({
    ok: true,
    targets,
    telegramAvailable: Boolean(process.env.TELEGRAM_ALERT_CHAT_ID),
    ...(pbError ? { warning: "config store unreachable" } : null),
  });
}

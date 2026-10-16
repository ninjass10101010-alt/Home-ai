// Server-only web-push sender. One row per browser/device subscription.
// Never throws: a cron/route calling this must keep working when push is
// unconfigured, and must prune dead endpoints (404/410) so the table stays
// bounded. Mirrors the failure-isolation posture of src/lib/ha/notify.ts.
import webpush from "web-push";
import { withAdmin } from "@/lib/pb-auth";
import { getServiceConfig } from "@/lib/services/config";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushFanoutResult {
  sent: number;
  pruned: number;
  failed: number;
  skipped?: "push_not_configured";
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configuredSignature: string | null = null;

async function ensureConfigured(): Promise<boolean> {
  const [pub, priv, subject] = await Promise.all([
    getServiceConfig("push_notifications", "VAPID_PUBLIC_KEY"),
    getServiceConfig("push_notifications", "VAPID_PRIVATE_KEY"),
    getServiceConfig("push_notifications", "VAPID_SUBJECT"),
  ]);
  if (!pub || !priv) return false;
  const signature = `${pub}|${priv}|${subject ?? ""}`;
  if (configuredSignature !== signature) {
    webpush.setVapidDetails(subject || "mailto:consuela@localhost", pub, priv);
    configuredSignature = signature;
  }
  return true;
}

export async function pushFanout(payload: PushPayload): Promise<PushFanoutResult> {
  const result: PushFanoutResult = { sent: 0, pruned: 0, failed: 0 };
  try {
    if (!(await ensureConfigured())) return { ...result, skipped: "push_not_configured" };
  } catch {
    return { ...result, skipped: "push_not_configured" };
  }

  let subs: SubRow[] = [];
  try {
    subs = (await withAdmin((pb) =>
      pb.collection("push_subscriptions").getFullList({ requestKey: null })
    )) as unknown as SubRow[];
  } catch {
    return { ...result, failed: 1 };
  }

  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      result.sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        try {
          await withAdmin((pb) => pb.collection("push_subscriptions").delete(sub.id));
          result.pruned += 1;
        } catch {
          result.failed += 1;
        }
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}
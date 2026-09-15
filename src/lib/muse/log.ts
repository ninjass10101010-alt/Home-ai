// Append-only MUSE audit log (Task 8 / B2). Every entry is best-effort: an
// audit write must never break, delay, or throw into an inbound request, so
// failures are swallowed. The log is capped at the newest 500 rows — after
// each write the tail (read ids sorted `-at`, oldest last) is deleted.

import { withAdmin } from "@/lib/pb-auth";

export interface MuseLogEntry {
  kind: "login" | "tool" | "auth_fail" | "rate_limited";
  keyPrefix?: string;
  tool?: string;
  ok: boolean;
  ms?: number;
  ip?: string;
  detail?: string;
  tokenAdmin?: boolean;
}

const COLLECTION = "consuela_muse_log";
const MAX_ROWS = 500;

export async function writeMuseLog(entry: MuseLogEntry): Promise<void> {
  try {
    await withAdmin(async (pb) => {
      await pb.collection(COLLECTION).create({ ...entry, at: new Date().toISOString() });
      const rows = await pb
        .collection(COLLECTION)
        .getFullList({ sort: "-at", fields: "id,at", requestKey: null });
      for (const stale of rows.slice(MAX_ROWS)) {
        await pb.collection(COLLECTION).delete(stale.id);
      }
    });
  } catch {
    // Auditing is never allowed to fail the inbound request.
  }
}

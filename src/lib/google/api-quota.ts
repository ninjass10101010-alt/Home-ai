import { withAdmin } from "../pb-auth.ts";

const DATE = new Date().toISOString().slice(0, 10);
const SOFT_LIMIT = 50_000;
const HARD_LIMIT = 100_000;

export async function recordApiCall(endpoint: string): Promise<{
  count: number;
  tripped: boolean;
  blocked: boolean;
}> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection("consuela_google_api_usage")
      .getFullList({ requestKey: null, filter: `date = "${DATE}"` });
    const row: any = rows[0] || {
      date: DATE,
      count: 0,
      last_endpoint: "",
      last_reset_at: new Date().toISOString(),
    };
    const next = (row.count || 0) + 1;
    const payload = {
      date: DATE,
      count: next,
      last_endpoint: endpoint,
      last_reset_at: row.last_reset_at,
    };
    if (rows.length === 0) {
      await pb
        .collection("consuela_google_api_usage")
        .create(payload, { requestKey: null });
    } else {
      await pb
        .collection("consuela_google_api_usage")
        .update(row.id, payload, { requestKey: null });
    }
    if (next > HARD_LIMIT) {
      console.error(
        `[google-quota] HARD LIMIT EXCEEDED: ${next} calls today (HARD=${HARD_LIMIT}). Blocking further calls.`,
      );
    } else if (next > SOFT_LIMIT) {
      console.warn(
        `[google-quota] soft limit tripped: ${next} calls today (SOFT=${SOFT_LIMIT}).`,
      );
    }
    return {
      count: next,
      tripped: next > SOFT_LIMIT,
      blocked: next > HARD_LIMIT,
    };
  });
}

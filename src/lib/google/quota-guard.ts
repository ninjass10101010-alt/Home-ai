import { withAdmin } from "../pb-auth.ts";

export async function checkQuota(headroomK = 2): Promise<{ ok: boolean; used: number; cap: number }> {
  return withAdmin(async (pb) => {
    const today = new Date().toISOString().split("T")[0];
    const rows = await pb
      .collection("consuela_google_api_usage")
      .getFullList({ filter: `date="${today}"` });
    const used = rows.reduce((acc, r) => acc + (r.count ?? 0), 0);
    const cap = 50_000 - headroomK * 1000;
    return { ok: used < cap, used, cap };
  });
}

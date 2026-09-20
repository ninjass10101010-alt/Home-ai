// Server-side Hall of Fame enshrinement — the missing "week champions" half of
// the Monday rollover.
//
// The client used to be the ONLY writer: the Tasks page's reload-backfill
// enshrined into the device's localStorage, and the PB push behind it was
// gateway-gated to PARENT sessions. When the first device to open the page
// after Monday was a kid/guest session (the kitchen display auto-logs-out
// after 30 min), the champion never landed in PocketBase — every other device
// saw an empty Hall of Fame forever (exactly the live state 2026-09-19: week
// 2026-09-07 had Aurora at 13 pts, hall_of_fame had 0 rows).
//
// This module recomputes the enshrinement from durable server truth
// (week_archive + members + weekly_prizes) and upserts the missing rows.
// Idempotent per (member, weekStart); never touches existing rows, so a
// `celebrated: true` stamp can never be lost. It runs as a self-healing step
// inside GET /api/tasks/sync — the 60s refresh every signed-in device already
// performs — so champions get recorded no matter which session is active.
import type { HallOfFameEntry, WeeklyPrize } from "@/types/tasks";
import { DEFAULT_WEEKLY_PRIZES } from "@/lib/task-utils";

type PB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

function parseMaybeJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return (value as T) ?? fallback;
}

/**
 * Pure: the Hall of Fame rows for one finished week. Mirrors the client's
 * `rankedEntriesFromWeek` + `archiveWeekWinner` semantics exactly:
 * - points > 0 only
 * - competition rank (1 + count of members with strictly more points — ties
 *   share a rank)
 * - rank ≤ 3 enshrined (a tie can make that more than 3 rows, by design)
 * - prize text frozen from the rank-keyed catalog, `celebrated` starts unset
 */
export function hallEntriesForWeek(
  weekPoints: Record<string, number>,
  weekStart: string,
  emojis: Record<string, string>,
  prizes: Pick<WeeklyPrize, "rank" | "text">[],
): HallOfFameEntry[] {
  const scored = Object.entries(weekPoints || {})
    .map(([member, points]) => ({ member, points: Number(points) || 0 }))
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.member.localeCompare(b.member));
  const out: HallOfFameEntry[] = [];
  for (const entry of scored) {
    const rank = 1 + scored.filter((o) => o.points > entry.points).length;
    if (rank > 3) continue;
    const record: HallOfFameEntry = {
      member: entry.member,
      emoji: emojis[entry.member] || "🏅",
      weekStart,
      points: entry.points,
      rank,
    };
    const prize = prizes.find((p) => p.rank === rank)?.text;
    if (typeof prize === "string" && prize.length > 0) record.prize = prize;
    out.push(record);
  }
  return out;
}

/**
 * Impure: ensure every archived week that carried points has its top-3 rows in
 * hall_of_fame. Returns the number of rows created (0 on a no-op pass). Never
 * deletes or updates existing rows — idempotent and celebration-safe.
 */
export async function ensureArchivedWeeksEnshrined(pb: PB): Promise<number> {
  const [archiveRows, hallRows, memberRows, prizeRows] = await Promise.all([
    pb.collection("week_archive").getFullList({ requestKey: null }),
    pb.collection("hall_of_fame").getFullList({ requestKey: null }),
    pb.collection("members").getFullList({ requestKey: null }),
    pb.collection("weekly_prizes").getFullList({ requestKey: null }),
  ]);

  const emojis: Record<string, string> = {};
  for (const m of memberRows as any[]) {
    if (m?.name) emojis[m.name] = m.emoji || "🏅";
  }
  const prizes = (prizeRows as any[]).map((p) => ({ rank: Number(p.rank) as 1 | 2 | 3, text: String(p.text || "") }));
  const prizeCatalog = prizes.length ? prizes : DEFAULT_WEEKLY_PRIZES.map((p) => ({ rank: p.rank, text: p.text }));
  const enshrined = new Set(
    (hallRows as any[]).map((h) => `${h.member}::${h.weekStart}`),
  );

  // Only the NEWEST finished week gets a live win ceremony — older weeks are
  // already history (their ceremony moment passed long ago), so their entries
  // are created pre-celebrated and stay visible in the Hall of Fame list.
  const archivedWeeks = (archiveRows as any[])
    .map((r) => String(r?.weekStart || ""))
    .filter(Boolean)
    .sort();
  const latestArchivedWeek = archivedWeeks[archivedWeeks.length - 1] ?? "";

  let created = 0;
  for (const row of archiveRows as any[]) {
    const weekStart = String(row?.weekStart || "");
    if (!weekStart) continue;
    const points = parseMaybeJSON<Record<string, number>>(row?.points, {});
    const entries = hallEntriesForWeek(points, weekStart, emojis, prizeCatalog);
    const isHistory = weekStart !== latestArchivedWeek;
    for (const entry of entries) {
      if (enshrined.has(`${entry.member}::${entry.weekStart}`)) continue;
      await pb.collection("hall_of_fame").create({
        ...entry,
        ...(isHistory ? { celebrated: true } : {}),
      });
      enshrined.add(`${entry.member}::${entry.weekStart}`);
      created++;
    }
  }
  return created;
}

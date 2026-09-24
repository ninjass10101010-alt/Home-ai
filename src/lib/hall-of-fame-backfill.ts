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

export async function ensureArchivedWeeksEnshrined(pb: PB): Promise<number> {
  const [archiveRows, hallRows, memberRows, prizeRows] = await Promise.all([
    pb.collection("week_archive").getFullList({ requestKey: null }),
    pb.collection("hall_of_fame").getFullList({ requestKey: null }),
    pb.collection("members").getFullList({ requestKey: null }),
    pb.collection("weekly_prizes").getFullList({ requestKey: null }),
  ]);

  const emojis: Record<string, string> = {};
  for (const member of memberRows as any[]) {
    if (member?.name && !emojis[member.name]) emojis[member.name] = member.emoji || "🏅";
  }
  const prizeByRank = new Map<number, string>();
  for (const row of [...(prizeRows as any[])].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const rank = Number(row.rank);
    if (![1, 2, 3].includes(rank) || typeof row.text !== "string" || !row.text) continue;
    if (!prizeByRank.has(rank)) prizeByRank.set(rank, row.text);
  }
  const prizeCatalog = prizeByRank.size
    ? [...prizeByRank].map(([rank, text]) => ({ rank: rank as 1 | 2 | 3, text }))
    : DEFAULT_WEEKLY_PRIZES.map((prize) => ({ rank: prize.rank, text: prize.text }));
  const byKey = new Map<string, any[]>();
  for (const row of hallRows as any[]) {
    const key = `${String(row.member ?? "")}\u0000${String(row.weekStart ?? "")}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const archivedWeeks = (archiveRows as any[])
    .map((row) => String(row?.weekStart || ""))
    .filter(Boolean)
    .sort();
  const latestArchivedWeek = archivedWeeks.at(-1) ?? "";
  const expected = new Map<string, HallOfFameEntry>();
  let changed = 0;

  for (const row of archiveRows as any[]) {
    const weekStart = String(row?.weekStart || "");
    if (!weekStart) continue;
    const points = parseMaybeJSON<Record<string, number>>(row?.points, {});
    const entries = hallEntriesForWeek(points, weekStart, emojis, prizeCatalog);
    const history = weekStart !== latestArchivedWeek;
    for (const entry of entries) {
      const key = `${entry.member}\u0000${entry.weekStart}`;
      expected.set(key, entry);
      const rows = byKey.get(key) ?? [];
      const celebrated = rows.some((candidate) => candidate.celebrated === true);
      if (rows.length === 0) {
        await pb.collection("hall_of_fame").create({
          ...entry,
          ...(history ? { celebrated: true } : {}),
        }, { requestKey: null });
        changed += 1;
        continue;
      }
      for (const candidate of rows) {
        const matches =
          Number(candidate.points) === entry.points &&
          Number(candidate.rank) === entry.rank &&
          String(candidate.emoji || "") === entry.emoji &&
          String(candidate.prize || "") === String(entry.prize || "");
        if (matches) continue;
        await pb.collection("hall_of_fame").update(candidate.id, {
          member: entry.member,
          weekStart: entry.weekStart,
          emoji: entry.emoji,
          points: entry.points,
          rank: entry.rank,
          prize: entry.prize ?? null,
          celebrated,
        }, { requestKey: null });
        changed += 1;
      }
    }
  }

  const verifiedRows = await pb.collection("hall_of_fame").getFullList({ requestKey: null });
  for (const entry of expected.values()) {
    const matches = (verifiedRows as any[]).filter(
      (row) => row.member === entry.member && row.weekStart === entry.weekStart,
    );
    if (matches.length === 0) throw new Error("hall_of_fame_write_missing");
    for (const row of matches) {
      if (
        Number(row.points) !== entry.points ||
        Number(row.rank) !== entry.rank ||
        String(row.emoji || "") !== entry.emoji ||
        String(row.prize || "") !== String(entry.prize || "")
      ) {
        throw new Error("hall_of_fame_write_mismatch");
      }
    }
  }
  return changed;
}

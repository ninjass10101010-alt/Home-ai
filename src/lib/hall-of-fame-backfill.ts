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
import { parseCanonicalTransactions, recomputeWeekPoints } from "@/lib/task-ledger";

type PB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

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

function isMondayWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

export async function ensureArchivedWeeksEnshrined(pb: PB): Promise<number> {
  const [archiveRows, hallRows, memberRows, prizeRows] = await Promise.all([
    pb.collection("week_archive").getFullList({ requestKey: null }),
    pb.collection("hall_of_fame").getFullList({ requestKey: null }),
    pb.collection("members").getFullList({ requestKey: null }),
    pb.collection("weekly_prizes").getFullList({ requestKey: null }),
  ]);
  if (![archiveRows, hallRows, memberRows, prizeRows].every(Array.isArray)) {
    throw new Error("hall_of_fame_read_failed");
  }

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
  for (const row of [...(hallRows as any[])].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const key = `${String(row.member ?? "")}\u0000${String(row.weekStart ?? "")}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const archiveGroups = new Map<string, { row: any; history: any[] }[]>();
  const protectedWeeks = new Set<string>();
  for (const row of archiveRows as any[]) {
    const weekStart = String(row?.weekStart || "");
    if (!isMondayWeekStart(weekStart)) {
      console.warn("[hall-of-fame] skipping archive row with an invalid week start");
      protectedWeeks.add(weekStart);
      continue;
    }
    if (row.history === undefined || row.history === null || row.history === "") {
      console.warn("[hall-of-fame] skipping archive row with a missing history");
      protectedWeeks.add(weekStart);
      continue;
    }
    const history = parseCanonicalTransactions(row.history);
    if (!history) {
      console.warn("[hall-of-fame] skipping archive row with an unreadable history");
      protectedWeeks.add(weekStart);
      continue;
    }
    history.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id - right.id);
    archiveGroups.set(weekStart, [...(archiveGroups.get(weekStart) ?? []), { row, history }]);
  }
  const archiveData: { row: any; weekStart: string; points: Record<string, number> }[] = [];
  for (const [weekStart, group] of [...archiveGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const first = group[0];
    if (group.some((candidate) => JSON.stringify(candidate.history) !== JSON.stringify(first.history))) {
      console.warn("[hall-of-fame] quarantining archive week with conflicting duplicates");
      protectedWeeks.add(weekStart);
      continue;
    }
    archiveData.push({ row: first.row, weekStart, points: recomputeWeekPoints(first.history) });
  }
  const archivedWeeks = archiveData.map(({ weekStart }) => weekStart).sort();
  const latestArchivedWeek = archivedWeeks.at(-1) ?? "";
  const expected = new Map<string, HallOfFameEntry>();
  let changed = 0;

  const coreMatches = (row: any, entry: HallOfFameEntry) =>
    !!row &&
    Number(row.points) === entry.points &&
    Number(row.rank) === entry.rank &&
    String(row.emoji || "") === entry.emoji &&
    String(row.prize || "") === String(entry.prize || "");

  const primaryRepairs: { id: string; entry: HallOfFameEntry }[] = [];
  for (const { weekStart, points } of archiveData) {
    const entries = hallEntriesForWeek(points, weekStart, emojis, prizeCatalog);
    const historical = weekStart !== latestArchivedWeek;
    for (const entry of entries) {
      const key = `${entry.member}\u0000${entry.weekStart}`;
      expected.set(key, entry);
      const rows = byKey.get(key) ?? [];
      const validRows = rows.filter((row) => coreMatches(row, entry));
      const celebrated = validRows.some((candidate) => candidate.celebrated === true);
      if (rows.length === 0) {
        await pb.collection("hall_of_fame").create({
          ...entry,
          ...(historical ? { celebrated: true } : {}),
        }, { requestKey: null });
        changed += 1;
        continue;
      }
      const primary = rows[0];
      if (!coreMatches(primary, entry)) {
        await pb.collection("hall_of_fame").update(primary.id, {
          member: entry.member,
          weekStart: entry.weekStart,
          emoji: entry.emoji,
          points: entry.points,
          rank: entry.rank,
          prize: entry.prize ?? null,
          celebrated,
        }, { requestKey: null });
        primaryRepairs.push({ id: String(primary.id), entry });
        changed += 1;
      }
    }
  }

  if (primaryRepairs.length > 0) {
    const readBack = await pb.collection("hall_of_fame").getFullList({ requestKey: null });
    const readBackById = new Map<string, any>();
    for (const row of Array.isArray(readBack) ? readBack : []) readBackById.set(String(row.id), row);
    for (const repair of primaryRepairs) {
      if (!coreMatches(readBackById.get(repair.id), repair.entry)) {
        throw new Error("hall_of_fame_primary_verification_failed");
      }
    }
  }

  for (const key of expected.keys()) {
    for (const duplicate of (byKey.get(key) ?? []).slice(1)) {
      await pb.collection("hall_of_fame").delete(duplicate.id, { requestKey: null });
      changed += 1;
    }
  }

  for (const row of [...(hallRows as any[])].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const key = `${String(row.member ?? "")}\u0000${String(row.weekStart ?? "")}`;
    if (expected.has(key)) continue;
    if (protectedWeeks.has(String(row.weekStart ?? ""))) continue;
    await pb.collection("hall_of_fame").delete(row.id, { requestKey: null });
    changed += 1;
  }

  const verifiedRows = await pb.collection("hall_of_fame").getFullList({ requestKey: null });
  if (!Array.isArray(verifiedRows)) throw new Error("hall_of_fame_read_failed");
  const verifiedByKey = new Map<string, any[]>();
  for (const row of verifiedRows) {
    const key = `${String(row.member ?? "")}\u0000${String(row.weekStart ?? "")}`;
    verifiedByKey.set(key, [...(verifiedByKey.get(key) ?? []), row]);
  }
  for (const [key, entry] of expected) {
    const rows = verifiedByKey.get(key) ?? [];
    if (rows.length !== 1 || !coreMatches(rows[0], entry)) {
      throw new Error("hall_of_fame_write_verification_failed");
    }
  }
  for (const [key, rows] of verifiedByKey) {
    if (expected.has(key)) continue;
    if (protectedWeeks.has(String(rows[0]?.weekStart ?? ""))) continue;
    throw new Error("hall_of_fame_stale_row");
  }
  return changed;
}

import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { requireLiveSession } from "@/lib/server-auth";
import { localWeekStartISO } from "@/lib/local-date";
import { buildAllTimeTotals, type AllTimeTotalsPayload, type ArchiveWeekRow } from "@/lib/all-time-totals";
import type { WeekData } from "@/types/tasks";

export const dynamic = "force-dynamic";

export const ALL_TIME_UNAVAILABLE_ERROR = "all_time_unavailable";

export const ALL_TIME_CACHE_TTL_MS = 45_000;

type Row = Record<string, unknown>;

type CacheEntry = {
  weekStart: string;
  startedAt: number;
  promise: Promise<AllTimeTotalsPayload>;
};

let cache: CacheEntry | null = null;

export function __resetAllTimeCache(): void {
  cache = null;
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable(): NextResponse {
  return NextResponse.json({ ok: false, error: ALL_TIME_UNAVAILABLE_ERROR }, { status: 503 });
}

function archiveWeekRows(rows: readonly unknown[]): ArchiveWeekRow[] {
  return rows.filter(isRecord).map((row) => ({
    weekStart: typeof row.weekStart === "string" ? row.weekStart : "",
    ...(typeof row.archivedAt === "string" ? { archivedAt: row.archivedAt } : {}),
    history: row.history,
    points: row.points,
  }));
}

function canonicalCurrentWeek(rows: readonly unknown[], weekStart: string): WeekData | null {
  const matching = rows.filter(
    (row): row is Row =>
      isRecord(row) && typeof row.weekStart === "string" && row.weekStart.trim() === weekStart,
  );
  if (matching.length !== 1) return null;
  const row = matching[0];
  return {
    weekStart,
    points: isRecord(row.points) ? (row.points as Record<string, number>) : {},
    streak: isRecord(row.streak) ? (row.streak as Record<string, number>) : {},
    lastActive: isRecord(row.lastActive) ? (row.lastActive as Record<string, string>) : {},
    history: row.history,
  } as unknown as WeekData;
}

function rosterNames(rows: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (row.role === "pet") continue;
    const fullName = typeof row.fullName === "string" ? row.fullName.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const resolved = fullName || name;
    if (resolved.length > 0 && !names.includes(resolved)) names.push(resolved);
  }
  return names;
}

function weekStartOf(row: unknown): string {
  return isRecord(row) && typeof row.weekStart === "string" ? row.weekStart.trim() : "";
}

/**
 * B4: `week_data` rows older than the current week that have NO `week_archive`
 * row. The rollover used to archive only ONE prior week, so any older row was
 * orphaned forever — its points vanished from all-time while this payload
 * actively asserted `historyComplete: true`. The rollover now archives every
 * older week, so this is the honest leftover: a week whose total is genuinely
 * unknown must be reported as unknown, not dropped.
 */
function unarchivedOlderWeekStarts(
  dataRows: readonly unknown[],
  archiveRows: readonly unknown[],
  weekStart: string,
): string[] {
  const archived = new Set(archiveRows.map(weekStartOf).filter((value) => value.length > 0));
  const starts: string[] = [];
  for (const row of dataRows) {
    const start = weekStartOf(row);
    if (!start || start === weekStart) continue;
    if (archived.has(start)) continue;
    if (starts.includes(start)) continue;
    starts.push(start);
  }
  return starts;
}

async function computePayload(weekStart: string): Promise<AllTimeTotalsPayload> {
  const read = await withAdmin(async (pb) => {
    const dataRows = await pb.collection("week_data").getFullList({ requestKey: null });
    const archiveRows = await pb.collection("week_archive").getFullList({ requestKey: null });
    const memberRows = await pb.collection("members").getFullList({ requestKey: null });
    return { dataRows, archiveRows, memberRows };
  });
  if (!Array.isArray(read.dataRows) || !Array.isArray(read.archiveRows) || !Array.isArray(read.memberRows)) {
    throw new Error("all_time_unreadable");
  }
  const currentWeek = canonicalCurrentWeek(read.dataRows, weekStart);
  if (!currentWeek) throw new Error("all_time_no_current_week");
  return buildAllTimeTotals(
    currentWeek,
    archiveWeekRows(read.archiveRows),
    rosterNames(read.memberRows),
    unarchivedOlderWeekStarts(read.dataRows, read.archiveRows, weekStart),
  );
}

export async function GET(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ ok: false, error: live.error }, { status: live.status });
  }

  const weekStart = localWeekStartISO();
  const now = Date.now();
  const reusable =
    cache !== null &&
    cache.weekStart === weekStart &&
    now - cache.startedAt < ALL_TIME_CACHE_TTL_MS
      ? cache
      : null;
  if (reusable) {
    try {
      return NextResponse.json(await reusable.promise, { status: 200 });
    } catch {
      if (cache?.promise === reusable.promise) cache = null;
      return unavailable();
    }
  }

  const promise = computePayload(weekStart);
  cache = { weekStart, startedAt: now, promise };
  try {
    return NextResponse.json(await promise, { status: 200 });
  } catch {
    if (cache?.promise === promise) cache = null;
    return unavailable();
  }
}

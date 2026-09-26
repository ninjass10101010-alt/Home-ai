import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { requireLiveSession } from "@/lib/server-auth";
import { localWeekStartISO } from "@/lib/local-date";
import { buildAllTimeTotals, type ArchiveWeekRow } from "@/lib/all-time-totals";
import type { WeekData } from "@/types/tasks";

export const dynamic = "force-dynamic";

export const ALL_TIME_UNAVAILABLE_ERROR = "all_time_unavailable";

type Row = Record<string, unknown>;

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

export async function GET(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ ok: false, error: live.error }, { status: live.status });
  }

  const weekStart = localWeekStartISO();
  let payload: ReturnType<typeof buildAllTimeTotals>;
  try {
    const read = await withAdmin(async (pb) => {
      const dataRows = await pb.collection("week_data").getFullList({ requestKey: null });
      const archiveRows = await pb.collection("week_archive").getFullList({ requestKey: null });
      return { dataRows, archiveRows };
    });
    if (!Array.isArray(read.dataRows) || !Array.isArray(read.archiveRows)) return unavailable();
    const currentWeek = canonicalCurrentWeek(read.dataRows, weekStart);
    if (!currentWeek) return unavailable();
    payload = buildAllTimeTotals(currentWeek, archiveWeekRows(read.archiveRows));
  } catch {
    return unavailable();
  }

  return NextResponse.json(payload, { status: 200 });
}

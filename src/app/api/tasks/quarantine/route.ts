import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyLiveParentSession } from "@/lib/live-member";
import { SNAPSHOT_COLLECTION, SNAPSHOT_KEY, normalizeWeekData } from "@/lib/snapshot-tasks";
import { recomputeWeekPoints } from "@/lib/task-ledger";
import {
  matchLegacyLedgerTransactions,
  serializeQuarantineReport,
  type QuarantineRequest,
  type QuarantineResponse,
} from "@/lib/task-ledger-quarantine";
import type { WeekData } from "@/types/tasks";

export const dynamic = "force-dynamic";

const QUARANTINE_DIR = "local-quarantine";

function emptyCanonicalWeek(weekStart: string): WeekData {
  return { weekStart, points: {}, streak: {}, lastActive: {}, history: [] };
}

function withRecomputedPoints(week: WeekData): WeekData {
  return { ...week, points: recomputeWeekPoints(week.history) };
}

function parseQuarantineRequest(body: unknown): QuarantineRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.mode !== "dry-run" && record.mode !== "export") return null;
  const localWeekData = normalizeWeekData(record.localWeekData);
  if (!localWeekData) return null;
  return { mode: record.mode, localWeekData: withRecomputedPoints(localWeekData) };
}

async function readCanonicalWeek(weekStart: string): Promise<WeekData> {
  return withAdmin(async (pb) => {
    const snapshotRows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const snapshotWeek = normalizeWeekData((snapshotRows?.[0] as any)?.data?.weekData);
    if (snapshotWeek && snapshotWeek.weekStart === weekStart) return withRecomputedPoints(snapshotWeek);

    const weekRows = await pb.collection("week_data").getFullList({ requestKey: null });
    const matching = (Array.isArray(weekRows) ? weekRows : []).filter(
      (row: any) => typeof row?.weekStart === "string" && row.weekStart.trim() === weekStart,
    );
    if (matching.length > 1) throw new Error("canonical_week_conflict");
    if (matching.length === 0) return emptyCanonicalWeek(weekStart);
    const week = normalizeWeekData(matching[0]);
    if (!week || week.weekStart !== weekStart) throw new Error("canonical_week_conflict");
    return withRecomputedPoints(week);
  });
}

function exportTargetPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), QUARANTINE_DIR, `task-ledger-${stamp}.json`);
}

export async function POST(request: NextRequest) {
  const auth = await verifyLiveParentSession(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_quarantine_request" }, { status: 400 });
  }

  const parsed = parseQuarantineRequest(body);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_quarantine_request" }, { status: 400 });
  }

  let canonical: WeekData;
  try {
    canonical = await readCanonicalWeek(parsed.localWeekData.weekStart);
  } catch {
    return NextResponse.json({ error: "canonical_week_unavailable" }, { status: 503 });
  }

  const report = matchLegacyLedgerTransactions(parsed.localWeekData, canonical);

  if (parsed.mode === "dry-run") {
    const response: QuarantineResponse = { ok: true, mode: "dry-run", report };
    return NextResponse.json(response);
  }

  const target = exportTargetPath();
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, serializeQuarantineReport(report), "utf8");
  } catch {
    return NextResponse.json({ error: "quarantine_export_failed" }, { status: 500 });
  }

  const response: QuarantineResponse = { ok: true, mode: "export", report, path: target };
  return NextResponse.json(response);
}

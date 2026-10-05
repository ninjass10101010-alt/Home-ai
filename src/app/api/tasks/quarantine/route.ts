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

const WEEK_START_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B5: `normalizeWeekData` accepts ANY non-empty string as a week key (it is a
 * snapshot normalizer, not a validator), so the client's own `weekStart` used
 * to arrive here unvalidated. A key must be SHAPE-valid AND round-trip through
 * `Date` — `2026-02-30` matches the regex but is not a real day.
 */
function isCanonicalWeekKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const weekStart = value.trim();
  if (!WEEK_START_SHAPE.test(weekStart)) return false;
  const parsed = new Date(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === weekStart;
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
  // Validated HERE, before any PocketBase read: a key the server could never
  // hold must not reach the store, and must not be answered with a verdict
  // about the family's ledger.
  if (!isCanonicalWeekKey(localWeekData.weekStart)) return null;
  return { mode: record.mode, localWeekData: withRecomputedPoints(localWeekData) };
}

/**
 * B5: `CanonicalWeekUnknown` is an EXPLICIT refusal, and it is distinct from
 * both "this week exists and is empty" (a report that legitimately finds
 * nothing) and "the canonical week cannot be decided" (a 503). Substituting an
 * empty ledger for a key with no canonical row told a device whose stored
 * `weekData.weekStart` is not byte-identical to a `week_data` row — a
 * hand-edited store, an old backup, a local-vs-UTC week key — that the family
 * had earned NOTHING that week, which the notice then renders to a parent as
 * "N old entries on this device are not on the server". That is a confident
 * wrong answer, so the unknown is now a named, non-fabricated refusal.
 */
class CanonicalWeekUnknown extends Error {}

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
    // Ambiguous stays a 503 — two candidate canonical rows is unreadable state,
    // not an unknown week, and must not be answered as either.
    if (matching.length > 1) throw new Error("canonical_week_conflict");
    if (matching.length === 0) throw new CanonicalWeekUnknown();
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
  } catch (error) {
    // 409, not 503: the server answered, and its answer is "I have no canonical
    // week for that key". Retrying cannot change that, so it must not present as
    // an outage — and it must not present as an empty ledger either. `canonical`
    // is left null and no report is produced, so nothing can echo the client's
    // own key back as `canonicalWeekStart`.
    if (error instanceof CanonicalWeekUnknown) {
      return NextResponse.json(
        { error: "canonical_week_unknown", canonicalWeekStart: null },
        { status: 409 },
      );
    }
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

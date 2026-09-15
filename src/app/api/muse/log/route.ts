import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { withAdmin } from "@/lib/pb-auth";

// Adult-gated audit read. The MUSE audit log is append-only (see
// src/lib/muse/log.ts); this exposes the newest entries, newest-first.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "consuela_muse_log";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function mapEntry(r: any) {
  return {
    id: r?.id ?? null,
    kind: r?.kind ?? null,
    keyPrefix: r?.keyPrefix ?? null,
    tool: r?.tool ?? null,
    ok: r?.ok === true,
    ms: typeof r?.ms === "number" ? r.ms : null,
    ip: r?.ip ?? null,
    detail: r?.detail ?? null,
    tokenAdmin: r?.tokenAdmin === true,
    at: r?.at ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const param = request.nextUrl.searchParams.get("limit");
  const parsed = param === null ? NaN : Number(param);
  const limit = Number.isFinite(parsed)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
    : DEFAULT_LIMIT;

  let rows: any[] = [];
  try {
    rows = await withAdmin((pb) =>
      pb.collection(COLLECTION).getFullList({ sort: "-at", requestKey: null })
    );
  } catch (err) {
    console.error("[muse/log] read failed:", err);
    return NextResponse.json({ ok: false, error: "log_unavailable" }, { status: 503 });
  }

  const entries = (Array.isArray(rows) ? rows : []).slice(0, limit).map(mapEntry);
  return NextResponse.json({ ok: true, entries });
}

import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isGatewayCollection, isSafeFilter, sanitizeClientRow, MAX_LIST_LIMIT } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

// Honest JSON errors instead of a bare 500 — the browser client falls back
// to its local cache on any non-ok, so an empty-body crash reads as "silent
// stale data" while a parseable error surfaces in devtools/logs.
function dbErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[db-gateway]", message);
  return NextResponse.json({ error: "db_error", detail: message }, { status: 502 });
}

export async function GET(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  // MF-4 — @collection/@request joins are a PIN oracle via the superuser
  // client; only plain field filters reach PB.
  if (!isSafeFilter(filter)) {
    return NextResponse.json({ error: "invalid_filter" }, { status: 400 });
  }
  const limit = Math.min(Number(url.searchParams.get("limit")) || MAX_LIST_LIMIT, MAX_LIST_LIMIT);
  try {
    const items = await withAdmin(async (pb) =>
      pb.collection(collection).getFullList({
        requestKey: null,
        sort: url.searchParams.get("sort") || "-created",
        filter: filter || undefined,
      })
    );
    return NextResponse.json({ items: (items as any[]).slice(0, limit) });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

export async function POST(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const body = sanitizeClientRow(parsed);
    const row = await withAdmin(async (pb) => pb.collection(collection).create(body, { requestKey: null }));
    return NextResponse.json(row);
  } catch (err) {
    return dbErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isGatewayCollection, sanitizeClientRow } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ collection: string; id: string }> };

function dbErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[db-gateway]", message);
  return NextResponse.json({ error: "db_error", detail: message }, { status: 502 });
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const row = await withAdmin(async (pb) => pb.collection(collection).getOne(id, { requestKey: null }));
    return NextResponse.json(row);
  } catch (err) {
    return dbErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
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
    const row = await withAdmin(async (pb) => pb.collection(collection).update(id, body, { requestKey: null }));
    return NextResponse.json(row);
  } catch (err) {
    return dbErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    await withAdmin(async (pb) => pb.collection(collection).delete(id, { requestKey: null }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

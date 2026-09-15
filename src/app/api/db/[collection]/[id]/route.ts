import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { isGatewayCollection, sanitizeClientRow, canWrite } from "@/lib/db-gateway";

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
  // Middleware already 401s guests, but authorization must also live in the
  // route: writes are role-gated per collection (F2).
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canWrite(collection, session.role)) {
    return NextResponse.json({ error: "adult_only" }, { status: 403 });
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

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canWrite(collection, session.role)) {
    return NextResponse.json({ error: "adult_only" }, { status: 403 });
  }
  try {
    await withAdmin(async (pb) => pb.collection(collection).delete(id, { requestKey: null }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

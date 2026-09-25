import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { requireLiveSession } from "@/lib/server-auth";
import { isGatewayCollection, sanitizeClientRow, canWrite, writePolicy } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ collection: string; id: string }> };

function dbErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const data = (err as { data?: unknown })?.data;
  console.error("[db-gateway]", message, data ?? "");
  return NextResponse.json(
    { error: "db_error", detail: message, data: data ?? undefined },
    { status: 502 }
  );
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
  const policy = writePolicy(collection);
  if (!policy) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (policy === "command") {
    return NextResponse.json({ error: "command_only" }, { status: 403 });
  }
  // Middleware already 401s guests, but authorization must also live in the
  // route: writes are role-gated per collection (F2).
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }
  if (!canWrite(collection, live.identity.role)) {
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
  const policy = writePolicy(collection);
  if (!policy) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (policy === "command") {
    return NextResponse.json({ error: "command_only" }, { status: 403 });
  }
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }
  if (!canWrite(collection, live.identity.role)) {
    return NextResponse.json({ error: "adult_only" }, { status: 403 });
  }
  try {
    await withAdmin(async (pb) => pb.collection(collection).delete(id, { requestKey: null }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

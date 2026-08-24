import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isGatewayCollection, sanitizeClientRow } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ collection: string; id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = await withAdmin(async (pb) => pb.collection(collection).getOne(id, { requestKey: null }));
  return NextResponse.json(row);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = sanitizeClientRow(await request.json());
  const row = await withAdmin(async (pb) => pb.collection(collection).update(id, body, { requestKey: null }));
  return NextResponse.json(row);
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { collection, id } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await withAdmin(async (pb) => pb.collection(collection).delete(id, { requestKey: null }));
  return NextResponse.json({ ok: true });
}

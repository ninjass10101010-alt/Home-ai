import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { isGatewayCollection, sanitizeClientRow, MAX_LIST_LIMIT } from "@/lib/db-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || MAX_LIST_LIMIT, MAX_LIST_LIMIT);
  const items = await withAdmin(async (pb) =>
    pb.collection(collection).getFullList({
      requestKey: null,
      sort: url.searchParams.get("sort") || "-created",
      filter: url.searchParams.get("filter") || undefined,
    })
  );
  return NextResponse.json({ items: (items as any[]).slice(0, limit) });
}

export async function POST(request: NextRequest, ctx: any) {
  const { collection } = await ctx.params;
  if (!isGatewayCollection(collection)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = sanitizeClientRow(await request.json());
  const row = await withAdmin(async (pb) => pb.collection(collection).create(body, { requestKey: null }));
  return NextResponse.json(row);
}

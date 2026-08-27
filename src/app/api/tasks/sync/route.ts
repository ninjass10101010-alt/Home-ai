import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";

export async function GET() {
  try {
    const result = await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      const row = rows[0] as any;
      return row?.data ?? null;
    });
    return NextResponse.json({ ok: true, snapshot: result });
  } catch (e: any) {
    console.error("[tasks/sync] read failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (
    !body ||
    !Array.isArray(body.tasks) ||
    typeof body.weekData !== "object" ||
    body.weekData === null ||
    typeof body.weekData.weekStart !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  try {
    await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      const payload = {
        key: KEY,
        data: body,
        updated_at: new Date().toISOString(),
      };
      if (rows.length > 0) {
        await pb.collection(COLLECTION).update(rows[0].id, payload, { requestKey: null });
      } else {
        await pb.collection(COLLECTION).create(payload, { requestKey: null });
      }
    });
    return NextResponse.json({ ok: true, saved: true });
  } catch (e: any) {
    console.error("[tasks/sync] save failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}

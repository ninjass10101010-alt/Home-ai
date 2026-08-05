import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";

export async function GET() {
  try {
    const result = await withAdmin(async (pb) => {
      try {
        const rows = await pb.collection(COLLECTION).getFullList({
          requestKey: null,
          filter: `key = "${KEY}"`,
        });
        const row = rows[0] as any;
        if (row?.data) return row.data;
        return null;
      } catch {
        return null;
      }
    });
    return NextResponse.json({ ok: true, snapshot: result });
  } catch {
    return NextResponse.json({ ok: true, snapshot: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
    return NextResponse.json({ ok: false, error: e?.message || "Save failed" }, { status: 500 });
  }
}

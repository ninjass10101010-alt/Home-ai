import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";
// The snapshot's non-tasks legs carry family points/ledger state. A child or
// pet session may sync the tasks leg only; the rest are ignored (never merged)
// and reported honestly in the response (F2) — the weekly prize legs are
// parent-owned the same way and are not applied from non-parent posts.
const NON_PARENT_IGNORED_LEGS = ["weekData", "rewards", "penalties", "weeklyPrizes", "weeklyPrizesStamp"];

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
  // Middleware already 401s guests, but the role decision must live here too.
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const isParent = session.role === "parent";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (isParent) {
    if (
      !body ||
      !Array.isArray(body.tasks) ||
      typeof body.weekData !== "object" ||
      body.weekData === null ||
      typeof body.weekData.weekStart !== "string"
    ) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
  } else if (!body || !Array.isArray(body.tasks)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  try {
    await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      // Parent writes the full body verbatim (unchanged). A non-parent writes
      // only the tasks leg, preserving the stored parent-owned legs so a kid
      // sync can never move points or wipe the ledger.
      const data = isParent
        ? body
        : { ...((rows[0] as any)?.data ?? {}), tasks: body.tasks };
      const payload = {
        key: KEY,
        data,
        updated_at: new Date().toISOString(),
      };
      if (rows.length > 0) {
        await pb.collection(COLLECTION).update(rows[0].id, payload, { requestKey: null });
      } else {
        await pb.collection(COLLECTION).create(payload, { requestKey: null });
      }
    });
    if (isParent) return NextResponse.json({ ok: true, saved: true });
    return NextResponse.json({ ok: true, saved: true, ignoredLegs: NON_PARENT_IGNORED_LEGS });
  } catch (e: any) {
    console.error("[tasks/sync] save failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}

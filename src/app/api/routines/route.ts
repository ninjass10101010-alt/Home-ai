import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { DEFAULT_ROUTINES, type FamilyRoutine } from "@/types/routines";

export const dynamic = "force-dynamic";

const COLLECTION = "consuela_state";
const ROUTINES_KEY = "family_routines";

export async function GET() {
  try {
    const row = await withAdmin(async (pb) => {
      try {
        return await pb.collection(COLLECTION).getFirstListItem(`key="${ROUTINES_KEY}"`);
      } catch {
        return null;
      }
    });

    if (row && Array.isArray((row as any).value) && (row as any).value.length > 0) {
      return NextResponse.json({ ok: true, routines: (row as any).value });
    }

    return NextResponse.json({ ok: true, routines: DEFAULT_ROUTINES });
  } catch (err) {
    console.error("[api/routines:GET]", err);
    return NextResponse.json({ ok: true, routines: DEFAULT_ROUTINES });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const routines: FamilyRoutine[] = Array.isArray(body?.routines) ? body.routines : [];

    await withAdmin(async (pb) => {
      try {
        const existing = await pb.collection(COLLECTION).getFirstListItem(`key="${ROUTINES_KEY}"`);
        await pb.collection(COLLECTION).update(existing.id, { value: routines });
      } catch {
        await pb.collection(COLLECTION).create({ key: ROUTINES_KEY, value: routines });
      }
    });

    return NextResponse.json({ ok: true, routines });
  } catch (err) {
    console.error("[api/routines:PUT]", err);
    return NextResponse.json({ ok: false, error: "failed_to_save" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}

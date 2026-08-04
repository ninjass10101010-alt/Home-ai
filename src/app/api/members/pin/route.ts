import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyPinFromPB } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actorName, actorPin, newPin } = body || {};

    if (!actorName || !actorPin) {
      return NextResponse.json({ error: "actorName and actorPin are required" }, { status: 400 });
    }
    if (!newPin || !/^\d{4}$/.test(String(newPin))) {
      return NextResponse.json({ error: "New PIN must be exactly 4 digits" }, { status: 400 });
    }

    const actor = await verifyPinFromPB(actorName, actorPin);
    if (!actor) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    await withAdmin(async (pb) => {
      return pb.collection("members").update(actor.id, { pin: String(newPin) });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Member PIN API error:", error);
    return NextResponse.json({ error: "Failed to change PIN" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Server-side PIN verification for client flows that used to verify against
// member data fetched straight from PocketBase in the browser (e.g. the Tasks
// page completion/undo/claim/redeem/adjust gates). The PIN never leaves the
// server unverified and the response is sanitized — no pin fields ship back.
export async function POST(request: NextRequest) {
  try {
    const { memberName, pin } = await request.json();
    if (!memberName || !pin) {
      return NextResponse.json({ error: "memberName and pin are required" }, { status: 400 });
    }
    const member = await verifyPinFromPB(String(memberName), String(pin));
    if (!member) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    return NextResponse.json({ success: true, member: sanitizeMember(member) });
  } catch {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}

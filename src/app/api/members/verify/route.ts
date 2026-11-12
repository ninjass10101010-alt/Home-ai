import { NextRequest, NextResponse } from "next/server";
import { verifyPinAgainstAnyMember, verifyPinFromPB, sanitizeMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Server-side PIN verification. Supports either `{ memberName, pin }` or
// `{ pin, requireRole: "parent" }` (when validating any parent's PIN for an
// action-level gate such as unlocking explicit music or dashboard settings).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
    const memberName = typeof body?.memberName === "string" ? body.memberName.trim() : "";
    const requireRole = typeof body?.requireRole === "string" ? body.requireRole.trim().toLowerCase() : "";

    if (!pin) {
      return NextResponse.json({ error: "pin is required" }, { status: 400 });
    }
    if (!memberName && requireRole !== "parent") {
      return NextResponse.json({ error: "memberName and pin are required" }, { status: 400 });
    }

    const member = memberName
      ? await verifyPinFromPB(memberName, pin)
      : await verifyPinAgainstAnyMember(pin);

    if (!member) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    if (requireRole && String(member.role || "").trim().toLowerCase() !== requireRole) {
      return NextResponse.json({ error: "adult_only" }, { status: 403 });
    }
    return NextResponse.json({ success: true, ok: true, member: sanitizeMember(member) });
  } catch {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}

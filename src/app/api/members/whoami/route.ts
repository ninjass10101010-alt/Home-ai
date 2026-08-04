import { NextRequest, NextResponse } from "next/server";
import { findMemberByName, sanitizeMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const name = request.nextUrl.searchParams.get("name");
    if (!name) {
      return NextResponse.json({ error: "name query param is required" }, { status: 400 });
    }

    const member = await findMemberByName(name);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ member: sanitizeMember(member) });
  } catch (error) {
    console.error("Member whoami API error:", error);
    return NextResponse.json({ error: "Failed to look up member" }, { status: 500 });
  }
}

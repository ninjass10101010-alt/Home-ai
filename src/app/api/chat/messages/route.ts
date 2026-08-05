import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawThreadId = request.nextUrl.searchParams.get("threadId");
  // L10 — defence-in-depth: the threadId flows into PB filters; a quote or
  // backslash would break the filter syntax. Currently always a UTC date at
  // runtime, but reject anything malformed.
  if (rawThreadId !== null && rawThreadId !== "") {
    if (rawThreadId.includes('"') || rawThreadId.includes("\\")) {
      return NextResponse.json({ error: "invalid threadId" }, { status: 400 });
    }
  }
  const threadId = rawThreadId || new Date().toISOString().split("T")[0];
  try {
    const messages = await db.selectChatMessages(threadId);
    return NextResponse.json({ ok: true, threadId, messages });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load messages" },
      { status: 500 }
    );
  }
}

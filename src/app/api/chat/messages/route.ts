import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const threadId =
    request.nextUrl.searchParams.get("threadId") ||
    new Date().toISOString().split("T")[0];
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

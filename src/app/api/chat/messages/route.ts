import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { requireLiveSession } from "@/lib/server-auth";

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
  const since = request.nextUrl.searchParams.get("since");
  if (since !== null && (since.includes('"') || since.includes("\\"))) {
    return NextResponse.json({ error: "invalid since" }, { status: 400 });
  }
  try {
    const messages = await db.selectChatMessages(threadId, since || undefined);
    return NextResponse.json({ ok: true, threadId, messages });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load messages" },
      { status: 500 }
    );
  }
}

// Conversation steering (2026-09-09): POST { action: "reset" } writes a
// system-role row into today's thread. The row is the family-visible "New
// conversation" divider AND the LLM context cutoff (the chat page only sends
// post-marker history to the model). Session-gated — guests keep a local-only
// reset (their device shows the divider, the family thread doesn't change).
export async function POST(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json({ error: live.error }, { status: live.status });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "reset") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }
  const threadId = new Date().toISOString().split("T")[0];
  try {
    await db.insertChatMessage({
      userId: live.identity.name || "family",
      role: "system",
      content: "New conversation",
      source: "dashboard",
      threadId,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, threadId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to write reset marker" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { queryMemories } from "@/lib/family-memory";

export const dynamic = "force-dynamic";

/** One-way memory export for the Mac Obsidian agent (scripts/obsidian-agent).
 *  Bearer-gated by CRON_SECRET like every cron route — fail-closed. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await queryMemories({ limit: 1000 });
  const memories = rows.map((m) => {
    let tags: string[] = [];
    try {
      const parsed = typeof m.tags === "string" ? JSON.parse(m.tags) : m.tags;
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch { /* keep [] */ }
    return {
      id: m.id,
      category: m.category,
      key: m.key,
      content: m.content,
      tags,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      usageCount: m.usageCount ?? 0,
      lastUsed: m.lastUsed ?? null,
    };
  });
  return NextResponse.json({ exportedAt: new Date().toISOString(), count: memories.length, memories });
}

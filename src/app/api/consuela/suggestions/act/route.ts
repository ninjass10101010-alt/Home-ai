import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getTool } from "@/lib/hermes-tools";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const items = await db.selectPendingSuggestions({ limit: 50 });
    const suggestion = items.find((s) => s.id === id);
    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found or not pending" }, { status: 400 });
    }
    const payload = suggestion.actionPayload;
    if (!payload?.tool) {
      return NextResponse.json({ error: "This suggestion has no attached action" }, { status: 400 });
    }
    const tool = getTool(payload.tool);
    if (!tool) {
      return NextResponse.json({ error: `Unknown tool: ${payload.tool}` }, { status: 400 });
    }
    const raw = await tool.handler((payload.args as Record<string, unknown>) || {});
    let result: unknown = raw;
    try {
      result = JSON.parse(raw);
    } catch {
      // keep raw string result
    }
    if (result && typeof result === "object" && (result as Record<string, unknown>).error) {
      return NextResponse.json({ error: String((result as Record<string, unknown>).error), result }, { status: 400 });
    }
    await db.updateSuggestion(id, { status: "actioned" });
    return NextResponse.json({ ok: true, tool: payload.tool, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Action failed" }, { status: 400 });
  }
}

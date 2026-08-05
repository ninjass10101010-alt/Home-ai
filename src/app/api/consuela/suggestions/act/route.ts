import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getTool } from "@/lib/hermes-tools";

export const dynamic = "force-dynamic";

// R2 — allowlist of tools the act route may dispatch. Only safe, non-admin,
// write-capable tools; admin tools (trigger_update, restart_container, ...) and
// get_* read tools are excluded on purpose.
const ALLOWED_TOOLS = new Set([
  "add_grocery_item",
  "add_task",
  "complete_task",
  "complete_grocery_item",
  "add_event",
  "remove_event",
  "dismiss_suggestion",
]);

export async function POST(request: NextRequest) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    const items = await db.selectPendingSuggestions({ limit: 50 });
    const suggestion = items.find((s) => s.id === id);
    if (!suggestion) {
      return NextResponse.json({ ok: false, error: "Suggestion not found or not pending" }, { status: 400 });
    }
    const payload = suggestion.actionPayload;
    if (!payload?.tool) {
      return NextResponse.json({ ok: false, error: "This suggestion has no attached action" }, { status: 400 });
    }
    if (!ALLOWED_TOOLS.has(payload.tool)) {
      return NextResponse.json({ ok: false, error: "tool not allowed" }, { status: 400 });
    }
    const tool = getTool(payload.tool);
    if (!tool) {
      return NextResponse.json({ ok: false, error: `Unknown tool: ${payload.tool}` }, { status: 400 });
    }
    const raw = await tool.handler((payload.args as Record<string, unknown>) || {});
    let result: unknown = raw;
    try {
      result = JSON.parse(raw);
    } catch {
      // keep raw string result
    }
    // R3 — success is only !result.error && result.ok !== false. Handlers may
    // report failure via an `error` key or an explicit `ok: false` (no error key).
    const parsed = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    if (parsed && (parsed.error || parsed.ok === false)) {
      const message = String(parsed.error || parsed.reason || "Action failed");
      return NextResponse.json({ ok: false, error: message, result }, { status: 400 });
    }
    await db.updateSuggestion(id, { status: "actioned" });
    return NextResponse.json({ ok: true, tool: payload.tool, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Action failed" }, { status: 400 });
  }
}

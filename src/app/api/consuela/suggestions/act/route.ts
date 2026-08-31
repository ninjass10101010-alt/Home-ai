import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getTool } from "@/lib/hermes-tools";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const PIN_HEADER = "x-consuela-pin";

// C3 — this route performs write actions, so it requires a family-member PIN
// verified server-side against PocketBase (mirrors /api/tasks/claim +
// /api/emergency). The client forwards the active session PIN from useAuth.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const pin =
    request.headers.get(PIN_HEADER) || request.cookies.get(PIN_HEADER)?.value || "";
  if (!pin) return false;
  const member = await verifyPinAgainstAnyMember(pin);
  return member !== null;
}

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
  "get_grocery_list",
  "dismiss_suggestion",
]);

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "pin required" }, { status: 401 });
  }
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

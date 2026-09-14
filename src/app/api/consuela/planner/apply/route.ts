import { NextRequest, NextResponse } from "next/server";
import { getTool } from "@/lib/hermes-tools";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const PIN_HEADER = "x-consuela-pin";

// Task 11 — buffer apply for the "Consuela's week" card. Mirrors
// /api/consuela/suggestions/act exactly: a write route, so it requires a
// family-member PIN (header or cookie) verified server-side against
// PocketBase via verifyPinAgainstAnyMember.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const pin =
    request.headers.get(PIN_HEADER) || request.cookies.get(PIN_HEADER)?.value || "";
  if (!pin) return false;
  const member = await verifyPinAgainstAnyMember(pin);
  return member !== null;
}

// Tighter than the act route's allowlist on purpose: the planner card may
// ONLY ever create a calendar event. Admin tools, completions, removals and
// read tools stay excluded.
const ALLOWED_TOOLS = new Set(["add_event"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts 24-hour ("14:30") AND 12-hour ("2:30 PM" / "2:30PM") — the calendar
// pages store both shapes.
const TIME_RE = /^\d{1,2}:\d{2}(\s*[AP]M)?$/i;

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "pin required" }, { status: 401 });
  }
  const { tool, args } = await request.json().catch(() => ({}));
  if (!tool || !ALLOWED_TOOLS.has(String(tool))) {
    return NextResponse.json({ ok: false, error: "tool not allowed" }, { status: 400 });
  }
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const title = typeof a.title === "string" ? a.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
  }
  const date = typeof a.date === "string" ? a.date.trim() : "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const time = a.time === undefined || a.time === null ? "" : String(a.time).trim();
  if (time && !TIME_RE.test(time)) {
    return NextResponse.json({ ok: false, error: "time must be HH:MM or H:MM AM/PM" }, { status: 400 });
  }
  const def = getTool(String(tool));
  if (!def) {
    return NextResponse.json({ ok: false, error: `Unknown tool: ${tool}` }, { status: 400 });
  }
  try {
    const raw = await def.handler({ ...a, title, date, ...(time ? { time } : {}) });
    let result: unknown = raw;
    try {
      result = JSON.parse(raw);
    } catch {
      // keep raw string result
    }
    // Same success rule as the act route: failure is an `error` key or an
    // explicit `ok: false` (Consuela never reports "Done" on a failed write).
    const parsed = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    if (!parsed || parsed.error || parsed.ok === false) {
      const message = String(parsed?.error || parsed?.reason || "Action failed");
      return NextResponse.json({ ok: false, error: message, result }, { status: 400 });
    }
    return NextResponse.json({ ok: true, event: parsed.event ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Action failed" }, { status: 400 });
  }
}

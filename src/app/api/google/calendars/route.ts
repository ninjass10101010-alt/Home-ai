import { NextRequest, NextResponse } from "next/server";
import { isGoogleConnected } from "@/lib/google/oauth-client";
import {
  listCalendars,
  readCalendarSyncRows,
  setCalendarSelection,
  pruneCalendar,
} from "@/lib/google/calendar";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { authorizeAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Multi-calendar selection API (Fix-C).
//
//   GET — any valid session (the middleware already 401s unauthenticated
//         requests): the Google calendarList merged with the saved selection
//         state, so the Settings card can render checkboxes + per-calendar
//         "last synced" lines.
//   PUT — adults only (same gate as /api/members/admin): saves the selection.
//         A deselected calendar is pruned (cached rows + sync token deleted);
//         a newly selected calendar has no token, so the next sync full-pulls.

interface CalendarEntry {
  id: string;
  summary: string;
  colorRgb: string | null;
  selected: boolean;
  lastSyncAt: string | null;
  lastStatus: string | null;
}

function mergeEntry(
  id: string,
  summary: string,
  colorRgb: string | null,
  row: Awaited<ReturnType<typeof readCalendarSyncRows>>[number] | undefined,
  fallbackSelected: boolean,
): CalendarEntry {
  return {
    id,
    summary: summary || row?.summary || id,
    colorRgb: colorRgb || row?.color_rgb || null,
    selected: row ? row.selected : fallbackSelected,
    lastSyncAt: row?.last_sync_at || null,
    lastStatus: row?.last_status || null,
  };
}

export async function GET() {
  try {
    await ensureGoogleCollections();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, connected: false, calendars: [], error: "PocketBase not reachable: " + (e?.message || "unknown") },
      { status: 200 },
    );
  }

  const saved = await readCalendarSyncRows().catch(() => []);
  const byId = new Map(saved.map((r) => [r.calendar_id, r]));
  const connected = await isGoogleConnected();

  if (!connected) {
    // Not connected (or a Composio-only setup): serve the saved selection so
    // the card still shows what was opted into; no Google call is made.
    const calendars: CalendarEntry[] = saved.map((r) =>
      mergeEntry(r.calendar_id, r.summary, r.color_rgb, r, false),
    );
    return NextResponse.json({ ok: true, connected: false, calendars });
  }

  let google;
  try {
    google = await listCalendars();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, connected: true, calendars: [], error: e?.message || "calendarList failed" },
      { status: 502 },
    );
  }

  const seen = new Set<string>();
  const calendars: CalendarEntry[] = google.map((c) => {
    seen.add(c.id);
    return mergeEntry(c.id, c.summary, c.colorRgb, byId.get(c.id), c.primary);
  });
  // Calendars we synced before but that vanished from the account: keep them
  // visible while still selected so their rows remain manageable.
  for (const r of saved) {
    if (!seen.has(r.calendar_id) && r.selected) {
      calendars.push(mergeEntry(r.calendar_id, r.summary, r.color_rgb, r, false));
    }
  }

  return NextResponse.json({ ok: true, connected: true, calendars });
}

export async function PUT(request: NextRequest) {
  const gate = await authorizeAdminRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
  }

  let body: { calendars?: { id?: unknown; selected?: unknown; summary?: unknown; colorRgb?: unknown }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const entries = Array.isArray(body?.calendars) ? body.calendars : null;
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "calendars[] is required" }, { status: 400 });
  }

  try {
    await ensureGoogleCollections();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "PocketBase not reachable: " + (e?.message || "unknown") },
      { status: 502 },
    );
  }

  const saved = await readCalendarSyncRows().catch(() => []);
  const byId = new Map(saved.map((r) => [r.calendar_id, r]));

  const pruned: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const selected = !!entry.selected;
    try {
      const prev = byId.get(id);
      const { wasSelected } = await setCalendarSelection({
        calendarId: id,
        selected,
        summary: typeof entry.summary === "string" ? entry.summary : prev?.summary || "",
        colorRgb:
          typeof entry.colorRgb === "string" ? entry.colorRgb : prev?.color_rgb ?? null,
      });
      if (wasSelected && !selected) {
        await pruneCalendar(id);
        pruned.push(id);
      }
    } catch (e: any) {
      errors.push({ id, error: e?.message || "selection failed" });
    }
  }

  if (errors.length && errors.length === entries.length) {
    return NextResponse.json({ ok: false, error: errors[0].error, errors }, { status: 500 });
  }
  return NextResponse.json({ ok: true, pruned, errors });
}

import { NextRequest, NextResponse } from "next/server";
import { scoreEvent } from "@/lib/calendar/importance";
import { withAdmin } from "@/lib/pb-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: NextRequest): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // If CRON_SECRET is unset, require explicit dev fallback to avoid open endpoint
  if (!process.env.CRON_SECRET) return false;
  return request.headers.get("authorization") === expected;
}

function getDurationMinutes(event: any): number {
  if (typeof event.duration === "number" && !Number.isNaN(event.duration)) {
    return event.duration;
  }
  // start/end as ISO strings
  const startIso = event.start || event.start_iso || event.startIso;
  const endIso = event.end || event.end_iso || event.endIso;
  if (startIso && endIso) {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
      return Math.round((e - s) / 60000);
    }
  }
  // duration expressed as string? e.g. "60"
  if (typeof event.duration === "string") {
    const n = parseInt(event.duration, 10);
    if (!Number.isNaN(n)) return n;
  }
  return 60;
}

function getMembers(event: any): string[] {
  if (Array.isArray(event.members) && event.members.length) return event.members;
  if (typeof event.member === "string" && event.member.trim().length > 0) {
    return [event.member];
  }
  if (Array.isArray(event.member) && event.member.length) return event.member;
  return [];
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getEventDateStr(event: any): string | null {
  if (typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(event.date)) {
    return event.date.slice(0, 10);
  }
  const iso = event.start || event.start_iso || event.startIso;
  if (typeof iso === "string" && iso.length >= 10) {
    // Date-only YYYY-MM-DD -> return as-is; ISO datetime -> local date via Date
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return iso.trim().slice(0, 10);
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return formatLocalDate(d);
  }
  return null;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(today.getDate() + 8);

  const todayStr = formatLocalDate(today);
  const endStr = formatLocalDate(end);

  try {
    // Fetch events. Try server-side date filter first (lexicographic YYYY-MM-DD);
    // fallback to full list + JS filter for robustness and for `start` ISO shapes.
    let events: any[] = [];
    let usedFallback = false;
    try {
      events = await withAdmin(async (pb) => {
        return pb.collection("events").getFullList({
          filter: `date >= "${todayStr}" && date < "${endStr}"`,
          requestKey: null,
        });
      });
    } catch {
      usedFallback = true;
      const all = await withAdmin(async (pb) =>
        pb.collection("events").getFullList({ requestKey: null }),
      );
      events = all.filter((e: any) => {
        const d = getEventDateStr(e);
        if (!d) return false;
        return d >= todayStr && d < endStr;
      });
    }
    if (!usedFallback) {
      // PB date filter succeeded but missed start-based rows (no `date` field).
      // Merge in-window start-based events so mixed collections are fully scored.
      try {
        const all = await withAdmin(async (pb) =>
          pb.collection("events").getFullList({ requestKey: null }),
        );
        const seen = new Set(events.map((e: any) => e.id));
        for (const e of all) {
          if (e.date) continue;
          if (seen.has(e.id)) continue;
          const d = getEventDateStr(e);
          if (d !== null && d >= todayStr && d < endStr) {
            events.push(e);
          }
        }
      } catch {
        // ignore supplement failures — primary date-filtered events still scored
      }
    }

    let scored = 0;
    const nowIso = new Date().toISOString();

    for (const event of events) {
      const title = event.title ?? "";
      const duration = getDurationMinutes(event);
      const members = getMembers(event);
      const { score, reason } = scoreEvent({ title, duration, members } as any);

      // Persist only when keyword matched (score > 0) — idempotent updates.
      // scoreEvent caps at 100, returns 0 when no keyword.
      if (score > 0) {
        await withAdmin(async (pb) =>
          pb.collection("events").update(event.id, {
            importanceScore: score,
            importanceReason: reason,
            importanceUpdatedAt: nowIso,
          }),
        );
        scored++;
      }
    }

    return NextResponse.json({ scored });
  } catch (e: any) {
    console.error("[cron/score-importance]", e);
    return NextResponse.json(
      { error: e?.message || "Failed to score events" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

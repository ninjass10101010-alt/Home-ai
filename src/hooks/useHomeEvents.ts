"use client";

import { useEffect, useState } from "react";
import { db } from "@/db";
import { withAdmin } from "@/lib/pb-auth";

/**
 * Home data hook for upcoming important events.
 *
 * Returns { todayEvents, upcomingImportant } where
 * upcomingImportant = PB query events where
 *   date >= tomorrow (local) && date < today+7d (local, exclusive)
 *   && importanceScore >= 50
 * ordered by -importanceScore, date asc and limited to 3.
 *
 * Uses local date strings (YYYY-MM-DD) to match the cron scorer's
 * local-midnight windowing. Falls back to JS filtering for `start`
 * shaped rows and for PB filter failures.
 */

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
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return iso.trim().slice(0, 10);
    const dd = new Date(iso);
    if (!Number.isNaN(dd.getTime())) return formatLocalDate(dd);
  }
  return null;
}

function getImportanceScore(event: any): number {
  const v = event.importanceScore;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

export interface HomeEventsResult {
  todayEvents: any[];
  upcomingImportant: any[];
}

/**
 * Fetch Home's today + upcoming-important events.
 *
 * - todayEvents from existing db.selectTodaysEvents() (unchanged pattern)
 * - upcomingImportant via PocketBase `events` filtered on local date window
 *   and importanceScore >= 50, sorted -importanceScore then date, limit 3
 */
export async function getHomeEvents(): Promise<HomeEventsResult> {
  // todayEvents — preserve existing pattern (sync cache read in db/index.ts)
  const rawToday = (db as any).selectTodaysEvents();
  const todayEvents: any[] = Array.isArray(rawToday) ? rawToday : await Promise.resolve(rawToday as any).catch(() => []) ?? [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const end = new Date(today);
  end.setDate(today.getDate() + 7);

  const tomorrowStr = formatLocalDate(tomorrow);
  const endStr = formatLocalDate(end);

  let upcomingImportant: any[] = [];

  // Primary: server-filtered getList (limit 3, sorted)
  try {
    const items: any[] = await withAdmin(async (pb) => {
      const col: any = pb.collection("events");
      // Prefer getList with server filter + sort + limit (PB paging)
      if (typeof col.getList === "function") {
        const page = await col.getList(1, 3, {
          filter: `date >= "${tomorrowStr}" && date < "${endStr}" && importanceScore >= 50`,
          sort: "-importanceScore,date",
          requestKey: null,
        });
        // getList returns { items, ... } or array in some mocks
        if (Array.isArray(page)) return page;
        if (page && Array.isArray(page.items)) return page.items;
        return [];
      }
      // Fallback if getList unavailable: fetch all and filter in JS
      const all = await col.getFullList({ requestKey: null });
      return all as any[];
    });

    // If primary used getList, items are already filtered/sorted/limited.
    // If it used getFullList fallback shape, we still need JS filter/sort/limit.
    // Detect: if we used getList, items length <=3 and already sorted by PB.
    // To be robust, re-apply JS filter/sort/slice when items came from getFullList
    // or when items contain out-of-window/unsorted entries. Cheapest: if any item
    // fails window/score check, re-filter.
    const needsJsFilter = items.some((e: any) => {
      const d = getEventDateStr(e);
      if (!d) return true;
      if (d < tomorrowStr || d >= endStr) return true;
      if (getImportanceScore(e) < 50) return true;
      return false;
    });

    if (needsJsFilter && items.length > 0) {
      // This branch means getFullList fallback was used or PB filter was bypassed
      upcomingImportant = items
        .filter((e: any) => {
          const d = getEventDateStr(e);
          if (!d) return false;
          if (d < tomorrowStr || d >= endStr) return false;
          return getImportanceScore(e) >= 50;
        })
        .sort((a: any, b: any) => {
          const sa = getImportanceScore(a);
          const sb = getImportanceScore(b);
          if (sb !== sa) return sb - sa;
          const da = getEventDateStr(a) || "";
          const db2 = getEventDateStr(b) || "";
          if (da !== db2) return da.localeCompare(db2);
          const ta = a.time || a.start || "";
          const tb = b.time || b.start || "";
          return String(ta).localeCompare(String(tb));
        })
        .slice(0, 3);
    } else {
      // Primary path: ensure JS sort for deterministic tie-break, then limit 3
      upcomingImportant = [...items]
        .sort((a: any, b: any) => {
          const sa = getImportanceScore(a);
          const sb = getImportanceScore(b);
          if (sb !== sa) return sb - sa;
          const da = getEventDateStr(a) || "";
          const db2 = getEventDateStr(b) || "";
          if (da !== db2) return da.localeCompare(db2);
          return 0;
        })
        .slice(0, 3);
    }
  } catch {
    // Secondary fallback: fetch all and filter in JS
    try {
      const all: any[] = await withAdmin(async (pb) => {
        return pb.collection("events").getFullList({ requestKey: null });
      });
      upcomingImportant = (all as any[])
        .filter((e: any) => {
          const d = getEventDateStr(e);
          if (!d) return false;
          if (d < tomorrowStr || d >= endStr) return false;
          return getImportanceScore(e) >= 50;
        })
        .sort((a: any, b: any) => {
          const sa = getImportanceScore(a);
          const sb = getImportanceScore(b);
          if (sb !== sa) return sb - sa;
          const da = getEventDateStr(a) || "";
          const db2 = getEventDateStr(b) || "";
          if (da !== db2) return da.localeCompare(db2);
          const ta = a.time || a.start || "";
          const tb = b.time || b.start || "";
          return String(ta).localeCompare(String(tb));
        })
        .slice(0, 3);
    } catch {
      upcomingImportant = [];
    }
  }

  return { todayEvents, upcomingImportant };
}

/**
 * React hook wrapper around getHomeEvents.
 * Client-only; fetches on mount.
 */
export function useHomeEvents() {
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [upcomingImportant, setUpcomingImportant] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getHomeEvents();
        if (!cancelled) {
          setTodayEvents(res.todayEvents);
          setUpcomingImportant(res.upcomingImportant);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load home events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { todayEvents, upcomingImportant, loading, error };
}

export default useHomeEvents;

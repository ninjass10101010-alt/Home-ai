"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { weekLabel, isoDateForWeekday } from "@/lib/meals-week-utils";

export default function MealsArchivePage() {
  const router = useRouter();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function loadArchives() {
    try {
      const raw = await db.selectMealWeekArchives() || [];
      setArchives(
        raw
          .map((a: any) => ({
            weekStart: a.weekStart,
            archivedAt: a.archivedAt,
            count: Array.isArray(a.data) ? a.data.length : 0,
          }))
          .sort((a: any, b: any) => b.weekStart.localeCompare(a.weekStart))
      );
    } catch {
      setArchives([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadArchives();
  }, []);

  async function restoreWeek(weekStart: string) {
    setRestoring(weekStart);
    try {
      const raw = await db.selectMealWeekArchives() || [];
      const entry = raw.find((a: any) => a.weekStart === weekStart);
      if (!entry?.data) throw new Error("No data found");
      const meals = Array.isArray(entry.data) ? entry.data : [];
      for (const meal of meals) {
        const { id, ...rest } = meal;
      await db.insertMeal({
        ...rest,
        weekOf: meal.weekOf || weekStart,
        date: meal.date || isoDateForWeekday(weekStart, meal.time || "Mon"),
      });
      }
      await db.deleteMealWeekArchive(weekStart);
      setArchives(prev => prev.filter(a => a.weekStart !== weekStart));
    } catch (e: any) {
      console.error("Restore failed:", e);
    }
    setRestoring(null);
  }

  return (
    <div className="min-h-screen pb-32 animate-fade-in">
      <div className="flex items-center gap-3 px-4 sm:px-6 pt-6 pb-4">
        <button
          onClick={() => router.push("/meals")}
          className="w-9 h-9 rounded-xl glass flex items-center justify-center text-text-secondary hover:text-text-primary tap-sm"
        >
          ‹
        </button>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Meal Archive</h1>
          <p className="text-sm text-text-muted">Restore past weeks back to the planner</p>
        </div>
      </div>

      <div className="px-4 sm:px-6 space-y-3">
        {loading && (
          <div className="glass rounded-2xl p-6 text-center text-text-muted">
            Loading archives...
          </div>
        )}

        {!loading && archives.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-text-muted">No archived weeks yet.</p>
            <p className="text-text-muted text-sm mt-1">
              Archive a week from the Meals tab to see it here.
            </p>
          </div>
        )}

        {archives.map(entry => (
          <div
            key={entry.weekStart}
            className="liquid-glass rounded-2xl p-4 flex items-center justify-between"
          >
            <div>
              <div className="font-semibold text-text-primary">
                {weekLabel(entry.weekStart)}
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                {entry.count} meal{entry.count !== 1 ? "s" : ""} · archived{" "}
                {entry.archivedAt
                  ? new Date(entry.archivedAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
            <button
              onClick={() => restoreWeek(entry.weekStart)}
              disabled={restoring === entry.weekStart}
              className="px-4 py-2 rounded-xl bg-[var(--color-accent-button)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 tap-sm"
            >
              {restoring === entry.weekStart ? "Restoring..." : "Restore"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

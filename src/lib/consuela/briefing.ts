import { runEngine } from "./engine";
import { withAdmin } from "@/lib/pb-auth";
import { db } from "@/db";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { localTodayISO } from "@/lib/local-date";
import type { ProactiveSuggestion } from "./types";

type BriefingRow = Record<string, unknown>;

export interface BriefingSummary {
  events: BriefingRow[];
  tasks: BriefingRow[];
  meals: BriefingRow[];
  suggestions: ProactiveSuggestion[];
  generatedAt: string;
}

function todayISO(): string { return localTodayISO(); }

export async function generateBriefing({ scopeDate }: { scopeDate: string }): Promise<BriefingSummary> {
  await runEngine({ scopeDate });

  const currentWeekStart = weekStartForDate(todayISO());
  const [events, tasks, meals, suggestions] = await Promise.all([
    withAdmin(async (pb) =>
      pb.collection("events").getFullList({
        filter: `date="${scopeDate}"`,
        requestKey: null,
      }) as unknown as BriefingRow[]
    ),
    withAdmin(async (pb) =>
      pb.collection("tasks").getFullList({ requestKey: null })
    ) as unknown as BriefingRow[],
    withAdmin(async (pb) =>
      pb.collection("meal_plan_entries").getFullList({
        filter: `weekOf="${currentWeekStart}"`,
        requestKey: null,
      })
    ) as unknown as BriefingRow[],
    db.selectPendingSuggestions({ scopeDate, limit: 5 }),
  ]);

  const summary: BriefingSummary = {
    events: events.slice(0, 5),
    tasks: tasks.filter((t) => t.status !== "done").slice(0, 6),
    meals,
    suggestions,
    generatedAt: new Date().toISOString(),
  };

  await db.upsertMorningBriefing(scopeDate, summary);
  return summary;
}

import { withAdmin } from "@/lib/pb-auth";
import { liveMembers } from "@/lib/consuela/live-reads";

export interface KidGoalRecord {
  id: string;
  member: string;
  cycleStart: string; // YYYY-MM-DD (Monday)
  cycleEnd: string;   // YYYY-MM-DD (Sunday)
  targetPoints: number;
  status: "active" | "completed";
  completedAt?: string | null;
  bonusPoints: number;
  reward?: string;
  created?: string;
  updated?: string;
}

export interface KidGoalView {
  id: string;
  member: string;
  displayName: string;
  emoji: string;
  role: string;
  age?: number;
  cycleStart: string;
  cycleEnd: string;
  targetPoints: number;
  currentPoints: number; // DERIVED DYNAMICALLY, NEVER STORED
  progress: number;      // 0 - 100
  status: "active" | "completed";
  completedAt: string | null;
  bonusPoints: number;
  reward?: string;
  daysRemaining: number;
}

export const ANCHOR_CYCLE_START = "2026-11-09"; // Monday Nov 9, 2026

export const DEFAULT_TARGETS: Record<string, { target: number; bonus: number }> = {
  "Emily Garcia": { target: 40, bonus: 10 },
  "Emily": { target: 40, bonus: 10 },
  "Bailey Garcia": { target: 40, bonus: 10 },
  "Bailey": { target: 40, bonus: 10 },
  "Jasmine Garcia": { target: 50, bonus: 10 },
  "Jasmine": { target: 50, bonus: 10 },
  "Aurora Garcia": { target: 30, bonus: 10 },
  "Aurora": { target: 30, bonus: 10 },
  "Caspian Garcia": { target: 20, bonus: 10 },
  "Caspian": { target: 20, bonus: 10 },
};

/** Format Date to YYYY-MM-DD in local time */
export function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calculate the Monday starting the 2-week cycle containing the given date */
export function getTwoWeekCycle(refDate: Date | string = new Date()): {
  cycleStart: string;
  cycleEnd: string;
  week1Start: string;
  week2Start: string;
  daysRemaining: number;
} {
  const d = typeof refDate === "string" ? new Date(`${refDate}T00:00:00`) : new Date(refDate);
  // Normalize to start of day
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  // Find Monday of the current week (0=Sun, 1=Mon, ..., 6=Sat)
  const dayOfWeek = target.getDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  const currentWeekMonday = new Date(target);
  currentWeekMonday.setDate(target.getDate() - diffToMonday);

  // Anchor is 2026-11-09
  const anchor = new Date(2026, 10, 9); // Month is 0-indexed: 10 = Nov
  const msDiff = currentWeekMonday.getTime() - anchor.getTime();
  const weekDiff = Math.floor(msDiff / (7 * 24 * 60 * 60 * 1000));
  
  // 2-week cycle parity: 0 or even = week 1 of cycle, odd = week 2 of cycle
  const cycleOffsetWeeks = (weekDiff % 2 + 2) % 2;
  const cycleMonday = new Date(currentWeekMonday);
  cycleMonday.setDate(currentWeekMonday.getDate() - cycleOffsetWeeks * 7);

  const week1Monday = new Date(cycleMonday);
  const week2Monday = new Date(cycleMonday);
  week2Monday.setDate(cycleMonday.getDate() + 7);

  const cycleSunday = new Date(cycleMonday);
  cycleSunday.setDate(cycleMonday.getDate() + 13);

  const now = new Date();
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const remainingMs = cycleSunday.getTime() - nowStart.getTime();
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) + 1);

  return {
    cycleStart: toISODate(cycleMonday),
    cycleEnd: toISODate(cycleSunday),
    week1Start: toISODate(week1Monday),
    week2Start: toISODate(week2Monday),
    daysRemaining,
  };
}

/** Resolve member name matching: checks if a task/point key matches this member */
export function isMemberMatch(key: string, member: { name: string; fullName?: string }): boolean {
  if (!key) return false;
  const k = key.trim().toLowerCase();
  const n = (member.name || "").trim().toLowerCase();
  const fn = (member.fullName || "").trim().toLowerCase();
  return Boolean(k === n || k === fn || (fn && fn.startsWith(k)) || (n && n.startsWith(k)));
}

/**
 * Derive points earned by a member during a 2-week cycle.
 * CRITICAL RULE: currentPoints is ALWAYS derived, NEVER read from stored goal.
 */
export async function deriveCyclePoints(
  pb: any,
  member: { name: string; fullName?: string },
  week1Start: string,
  week2Start: string
): Promise<number> {
  let pointsFromWeeks = 0;
  try {
    const weeks = await pb.collection("week_data").getFullList({
      filter: `weekStart = '${week1Start}' || weekStart = '${week2Start}'`,
      requestKey: null,
    });
    for (const w of weeks) {
      const pts = w.points || {};
      for (const [k, val] of Object.entries(pts)) {
        if (typeof val === "number" && isMemberMatch(k, member)) {
          pointsFromWeeks += val;
        }
      }
    }
  } catch (err) {
    // If week_data fails, fallback to task calculation
  }

  // Also query completed tasks in the 2-week window as a secondary source of truth
  let pointsFromTasks = 0;
  try {
    const doneTasks = await pb.collection("tasks").getFullList({
      filter: `completed = true && (completedInWeek = '${week1Start}' || completedInWeek = '${week2Start}')`,
      requestKey: null,
    });
    for (const t of doneTasks) {
      const completedBy = t.completedBy || t.assignee || "";
      if (isMemberMatch(completedBy, member)) {
        const p = typeof t.awardedPoints === "number" ? t.awardedPoints : (typeof t.points === "number" ? t.points : 0);
        pointsFromTasks += p;
      }
    }
  } catch {}

  // Max of the two ensures any audited week_data entry or verified task is respected
  return Math.max(pointsFromWeeks, pointsFromTasks);
}

/**
 * List all kid goals for the active 2-week cycle with live derived points.
 */
export async function listActiveKidGoals(targetDate: Date | string = new Date()): Promise<KidGoalView[]> {
  const cycle = getTwoWeekCycle(targetDate);
  const members = await liveMembers();
  if (!members) return [];

  const kids = members.filter((m: any) => String(m.role || "").toLowerCase() === "child");

  return withAdmin(async (pb) => {
    // Fetch all goal records for this cycle
    let storedGoals: KidGoalRecord[] = [];
    try {
      storedGoals = await pb.collection("goals").getFullList({
        filter: `cycleStart = '${cycle.cycleStart}'`,
        requestKey: null,
      });
    } catch {
      storedGoals = [];
    }

    const views: KidGoalView[] = [];

    for (const kid of kids) {
      const fullName = kid.fullName || kid.name;
      const shortName = kid.name.split(" ")[0];
      
      let existing = storedGoals.find((g) => isMemberMatch(g.member, kid));

      // If no goal exists for this kid in this cycle, initialize with standard targets
      if (!existing) {
        const defaults = DEFAULT_TARGETS[fullName] || DEFAULT_TARGETS[shortName] || { target: 30, bonus: 10 };
        try {
          existing = await pb.collection("goals").create({
            member: fullName,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            targetPoints: defaults.target,
            status: "active",
            bonusPoints: defaults.bonus,
            reward: "",
          });
        } catch {
          // Fallback in-memory representation if write fails
          existing = {
            id: `temp-${kid.id}`,
            member: fullName,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            targetPoints: defaults.target,
            status: "active",
            bonusPoints: defaults.bonus,
            reward: "",
          };
        }
      }

      if (!existing) continue;

      // DERIVE POINTS DYNAMICALLY
      const currentPoints = await deriveCyclePoints(pb, kid, cycle.week1Start, cycle.week2Start);
      const isCompleted = currentPoints >= existing.targetPoints;
      const status: "active" | "completed" = isCompleted ? "completed" : "active";

      // If status changed to completed, stamp completedAt in PocketBase
      if (isCompleted && existing.status !== "completed" && existing.id && !existing.id.startsWith("temp-")) {
        try {
          const nowIso = new Date().toISOString();
          await pb.collection("goals").update(existing.id, {
            status: "completed",
            completedAt: nowIso,
          });
          existing.status = "completed";
          existing.completedAt = nowIso;
        } catch {}
      }

      const progress = existing.targetPoints > 0
        ? Math.min(100, Math.round((currentPoints / existing.targetPoints) * 100))
        : 100;

      views.push({
        id: existing.id,
        member: fullName,
        displayName: shortName,
        emoji: kid.emoji?.startsWith("data:") ? "👤" : (kid.emoji || "👤"),
        role: kid.role,
        age: kid.age,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        targetPoints: existing.targetPoints,
        currentPoints,
        progress,
        status,
        completedAt: existing.completedAt || null,
        bonusPoints: existing.bonusPoints ?? 10,
        reward: existing.reward || undefined,
        daysRemaining: cycle.daysRemaining,
      });
    }

    return views;
  });
}

/**
 * Update or set a kid's goal (Parent capability).
 */
export async function setKidGoal(
  member: string,
  targetPoints: number,
  options?: { reward?: string; bonusPoints?: number; cycleStart?: string }
): Promise<KidGoalRecord | null> {
  const cycle = getTwoWeekCycle(options?.cycleStart || new Date());
  
  return withAdmin(async (pb) => {
    try {
      const records = await pb.collection("goals").getFullList({
        filter: `cycleStart = '${cycle.cycleStart}' && member ~ '${member}'`,
        requestKey: null,
      });

      const payload = {
        member,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        targetPoints,
        status: "active",
        bonusPoints: options?.bonusPoints ?? 10,
        reward: options?.reward ?? "",
      };

      if (records.length > 0) {
        return await pb.collection("goals").update(records[0].id, payload);
      } else {
        return await pb.collection("goals").create(payload);
      }
    } catch (err) {
      return null;
    }
  });
}

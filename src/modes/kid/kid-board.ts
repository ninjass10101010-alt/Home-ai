/**
 * Kid board — pure helpers for KidHome's "🤝 Join a crew!" + "🫳 Up for grabs"
 * board. All crew math reuses @/lib/task-utils (never reimplemented); like
 * quest-labels.ts this module is pure so the board's classification is unit
 * testable without mounting KidHome.
 */
import {
  isCrewTask,
  isSnatchable,
  crewFull,
  crewHasMember,
  crewMembers,
  crewMemberCheckedIn,
  crewAllCheckedIn,
} from "@/lib/task-utils";

export type KidBoardState = "joinable" | "joined" | "checked-in" | "all-done" | "open";

export interface BoardRosterMember {
  name: string;
  emoji?: string;
  color?: string;
}

export interface BoardAvatar {
  name: string;
  emoji: string;
  color: string;
  checkedIn: boolean;
}

const first = (v?: string | null) => (v || "").trim().split(" ")[0].toLowerCase();

function rosterMatch(roster: BoardRosterMember[], name: string): BoardRosterMember | undefined {
  return roster.find((r) => r.name === name) ?? roster.find((r) => first(r.name) === first(name));
}

/** Classify what a kid can do with a task on the board (null = not on it). */
export function kidBoardState(task: any, memberName: string): KidBoardState | null {
  if (!task || task.completed) return null;
  if (isCrewTask(task)) {
    if (crewFull(task) && !crewHasMember(task, memberName)) return null;
    if (crewHasMember(task, memberName)) {
      if (!crewMemberCheckedIn(task, memberName)) return "joined";
      return crewAllCheckedIn(task) ? "all-done" : "checked-in";
    }
    return "joinable";
  }
  if (task.universal || isSnatchable(task)) return "open";
  return null;
}

const JOIN_LEAD: Record<KidBoardState, number> = {
  joinable: 0,
  joined: 1,
  "checked-in": 2,
  "all-done": 3,
  open: 4,
};

/** Board rows: crews (joinable first, then points desc) + open (points desc). */
export function splitKidBoard(tasks: any[], memberName: string): { crews: any[]; open: any[] } {
  const crews: any[] = [];
  const open: any[] = [];
  for (const task of tasks) {
    const state = kidBoardState(task, memberName);
    if (!state) continue;
    if (state === "open") open.push(task);
    else crews.push(task);
  }
  const byPoints = (a: any, b: any) => (b.points || 0) - (a.points || 0);
  crews.sort(
    (a, b) =>
      JOIN_LEAD[kidBoardState(a, memberName)!] - JOIN_LEAD[kidBoardState(b, memberName)!] ||
      byPoints(a, b),
  );
  open.sort(byPoints);
  return { crews, open };
}

export function crewProgressLabel(task: any): string {
  const joined = crewMembers(task).length;
  const total = typeof task?.crewSize === "number" ? task.crewSize : 0;
  return `${joined} of ${total} joined`;
}

export function crewWaitingNames(task: any, memberName: string): string[] {
  return crewMembers(task)
    .filter((m) => m.name !== memberName && !m.checkedInAt)
    .map((m) => m.name.split(" ")[0]);
}

/** Joined faces resolved from the LIVE roster; stored emoji as fallback. */
export function crewAvatars(task: any, roster: BoardRosterMember[]): BoardAvatar[] {
  return crewMembers(task).map((m) => {
    const live = rosterMatch(roster, m.name);
    return {
      name: m.name,
      emoji: live?.emoji || m.emoji || "🙂",
      color: live?.color || "green",
      checkedIn: !!m.checkedInAt,
    };
  });
}

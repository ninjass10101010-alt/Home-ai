// Suggestion mapping for the Tasks page ✨ Generate / Suggest buttons (Task 10).
// The planner route answers {agent:"planner", intent:"task_ideas"|"reward_ideas"}
// with validated {actions:[{type,title,detail?,emoji?,assignee?,points?}]};
// these pure helpers adapt those rows to the page's Task/Reward suggestion
// shapes. The task mapper is the honesty seam: an assignee that doesn't match
// the live roster means the suggestion is DROPPED — never defaulted onto a
// named family member (the old `|| "Caspian"` fallback).

import type { Task, Reward } from "@/types/tasks";

interface ActionLike {
  type?: string;
  title?: string;
  detail?: string;
  emoji?: string;
  assignee?: string;
  points?: number;
}

interface MemberLike {
  name?: string;
  fullName?: string;
  emoji?: string;
}

/** First-name-or-full-name prefix match against the live roster (the same
 *  lenience the old detail-string parser had — minus the invented fallback). */
export function matchMember(assignee: string | undefined, members: MemberLike[]): MemberLike | null {
  const a = (assignee || "").trim();
  if (!a) return null;
  return members.find((m: any) =>
    (m.fullName && m.fullName.startsWith(a)) ||
    (m.name && m.name.startsWith(a)) ||
    (m.name && a.startsWith(m.name))
  ) || null;
}

export function mapTaskIdeas(
  actions: ActionLike[] | undefined,
  members: MemberLike[],
  ctx: { nextId: () => number; today: string },
): Task[] {
  const out: Task[] = [];
  for (const a of actions || []) {
    if (!a || a.type !== "task" || !a.title) continue;
    const member = matchMember(a.assignee, members) as any;
    if (!member) continue;
    const n = Number(a.points);
    const points = Number.isFinite(n) && n >= 1 ? Math.round(n) : 8;
    out.push({
      id: ctx.nextId(),
      title: a.title,
      assignee: member.fullName || member.name,
      assigneeEmoji: member.emoji || "🧒",
      due: ctx.today,
      points,
      recurring: null,
      category: "AI Suggested",
      completed: false,
      priority: points >= 15 ? "high" : points >= 10 ? "medium" : "low",
    } as Task);
  }
  return out;
}

export function mapRewardIdeas(actions: ActionLike[] | undefined): Reward[] {
  const out: Reward[] = [];
  const list = actions || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    // The old page accepted both shapes (the model sometimes typed chores as
    // rewards); the validator keeps that lenience harmless, so do the same.
    if (!a || (a.type !== "reward" && a.type !== "task") || !a.title) continue;
    const n = Number(a.points);
    const cost = Number.isFinite(n) && n >= 1 ? Math.round(n) : 50;
    out.push({ id: Date.now() + i, name: a.title, emoji: a.emoji || "🎁", cost });
  }
  return out;
}

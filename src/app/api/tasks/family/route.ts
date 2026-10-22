import { NextResponse } from "next/server";
import { readSnapshotTasks } from "@/lib/snapshot-tasks";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/family — the family's CHORES, for a wall that is signed out.
 *
 * The wall is a FAMILY DISPLAY: the calendar, the schedules, the meals, the
 * photos and the roster are already session-exempt reads, so a signed-out
 * panel still shows the family's information. The tasks card was the last
 * surface that was not — /api/tasks/sync needs a live session, so the wall
 * showed "Sign in to see the family's tasks" while every other card stayed
 * alive.
 *
 * This route is the chores-only lane that closes that gap. It reads the SAME
 * snapshot the signed-in path reads (the `tasks-snapshot` record in
 * `consuela_data_snapshots` — the same store /api/tasks/sync hands over) and
 * projects FOUR fields per chore: `{ id, title, assignee, done }`.
 *
 * WHAT IT NEVER CARRIES:
 *   · points — the family's money is not a wall decoration;
 *   · the pending-approval queue — a parent's queue is a parent's business;
 *   · completedBy / completedAt / awardedPoints — who finished a chore, when
 *     and for how much;
 *   · the ledger, the crew roster, the PIN state — none of it is on a wall.
 *
 * It answers the OPEN chores only: a completed row is exactly where the
 * approval queue lives, so publishing "this one is done" would leak the
 * queue's shape through the `done` flag even without the marker itself.
 *
 * The route is read-only and session-EXEMPT (src/middleware.ts carries the
 * entry and the comment that says what is public and what stays gated). An
 * unreadable snapshot is an honest 503 with NO `chores` key — "no truth" must
 * never read as "no chores".
 */
export async function GET(_request?: Request) {
  try {
    const tasks = await readSnapshotTasks();
    const chores = tasks
      // A row without a usable id is malformed; it never reaches the wall.
      .filter((task) => Number.isSafeInteger(Number((task as { id?: unknown })?.id)))
      // Open rows only — see the note above (a done row IS the approval queue).
      .filter((task) => (task as { completed?: unknown })?.completed !== true)
      .map((task) => ({
        id: Number((task as { id: unknown }).id),
        title: typeof (task as { title?: unknown }).title === "string" ? (task as { title: string }).title : "",
        assignee: typeof (task as { assignee?: unknown }).assignee === "string" ? (task as { assignee: string }).assignee : "",
        done: false,
      }));
    return NextResponse.json({ ok: true, chores });
  } catch {
    console.warn("[tasks/family] snapshot read unavailable");
    return NextResponse.json(
      { ok: false, error: "snapshot_unavailable", retryable: true },
      { status: 503 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyPinFromPB } from "@/lib/server-auth";
import type { Transaction, WeekData } from "@/types/tasks";

export const dynamic = "force-dynamic";

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

function normalizeMemberName(member: any): string {
  return member?.name || "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, claimantName, claimantPin, assigneeEmoji } = body || {};

    if (taskId === undefined || !claimantName || !claimantPin) {
      return NextResponse.json({ error: "taskId, claimantName, and claimantPin are required" }, { status: 400 });
    }

    const claimant = await verifyPinFromPB(claimantName, claimantPin);
    if (!claimant) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const currentWeek = currentWeekKey();
    const normalizedName = normalizeMemberName(claimant);

    const result = await withAdmin(async (pb) => {
      // Server-authoritative task lookup FIRST: the stored row decides the
      // points value. The request body is never trusted for scoring — a
      // forged body could otherwise mint arbitrary points.
      const taskRecords = await pb.collection("tasks").getFullList({ requestKey: null });
      const task = taskRecords.find((r: any) => r.taskId === Number(taskId));
      if (!task) {
        return { ok: false, reason: "unknown-task" } as const;
      }

      const weekRecords = await pb.collection("week_data").getFullList({ requestKey: null });
      let week = weekRecords.find((r: any) => r.weekStart === currentWeek) || null;

      const points = parseJSON<Record<string, number>>(week?.points, {});
      const history = parseJSON<Transaction[]>(week?.history, []);

      // Server-authoritative check: was this task already claimed/completed this week?
      const existingTx = history.find(
        (tx) => tx.taskId === Number(taskId) && tx.type === "earn"
      );
      if (existingTx) {
        return {
          ok: false,
          reason: "already-claimed",
          claimedBy: existingTx.member,
        };
      }

      const now = new Date().toISOString();
      const amount = Number(task.points) || 0;
      const tx: Transaction = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: now,
        member: normalizedName,
        type: "earn",
        amount,
        description: `Completed: ${task.title || "task"}${amount > 0 ? ` (+${amount}pts)` : ""}`,
        taskId: Number(taskId),
      };

      const updatedPoints = { ...points, [normalizedName]: (points[normalizedName] || 0) + amount };
      const updatedWeek: WeekData = {
        weekStart: currentWeek,
        points: updatedPoints,
        streak: parseJSON<Record<string, number>>(week?.streak, {}),
        lastActive: parseJSON<Record<string, string>>(week?.lastActive, {}),
        history: [...history, tx],
      };

      if (week) {
        await pb.collection("week_data").update(week.id, updatedWeek);
      } else {
        await pb.collection("week_data").create(updatedWeek);
      }

      // Lost-update detection: PocketBase has no conditional updates, so a
      // concurrent claim can overwrite ours after both passed the guard
      // above. Re-read what actually landed — if our transaction is gone,
      // another device won the race and we must report an honest 409 rather
      // than pretend the claim succeeded.
      const verifyRow: any = week
        ? await pb.collection("week_data").getOne(week.id, { requestKey: null })
        : (await pb.collection("week_data").getFullList({ requestKey: null }))
            .find((r: any) => r.weekStart === currentWeek);
      const verifiedHistory = parseJSON<Transaction[]>(verifyRow?.history, []);
      if (!verifiedHistory.some((t) => t.id === tx.id)) {
        const winner = verifiedHistory.find(
          (t) => t.taskId === Number(taskId) && t.type === "earn"
        );
        return { ok: false, reason: "already-claimed", claimedBy: winner?.member };
      }

      // Record the claim on the task row so the tasks collection reflects the new assignee
      await pb.collection("tasks").update(task.id, {
        assignee: normalizedName,
        assigneeEmoji: assigneeEmoji || claimant.emoji || "",
      }).catch(() => {});

      return { ok: true, claimedBy: normalizedName, weekData: updatedWeek };
    });

    if (!result.ok) {
      const status = result.reason === "unknown-task" ? 404 : 409;
      return NextResponse.json({
        success: false,
        reason: result.reason,
        claimedBy: (result as any).claimedBy,
      }, { status });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Task claim API error:", error);
    return NextResponse.json({ error: "Failed to claim task" }, { status: 500 });
  }
}

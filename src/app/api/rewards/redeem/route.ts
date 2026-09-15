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

// A same (member, reward, amount) redeem replay inside this window is a
// double-tap, not a second purchase — refused honestly, one transaction.
// Mirrors the planner/apply adjustment dedupe idiom.
const REDEEM_DEDUPE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rewardId, rewardName, memberName, pin } = body || {};

    if (rewardId === undefined || rewardId === null || !memberName) {
      return NextResponse.json({ error: "rewardId and memberName are required" }, { status: 400 });
    }
    // A missing or wrong PIN is the same honest failure to the caller.
    if (!pin) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const member = await verifyPinFromPB(memberName, pin);
    if (!member) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const currentWeek = currentWeekKey();
    const normalizedName = member.name || memberName;

    const result = await withAdmin(async (pb) => {
      // Server-authoritative reward lookup FIRST: the stored row decides the
      // real cost/title. The request body is never trusted for cost — a forged
      // body could otherwise buy a 150-point reward for 1 point.
      const rewardRows = await pb.collection("rewards").getFullList({ requestKey: null });
      const reward =
        rewardRows.find((r: any) => String(r.id) === String(rewardId)) ||
        (rewardName
          ? rewardRows.find((r: any) => String(r.name) === String(rewardName))
          : null);
      if (!reward) {
        return { ok: false, reason: "unknown-reward" } as const;
      }

      const cost = Number(reward.cost ?? reward.points) || 0;
      const title = reward.name || "reward";
      const description = `Redeemed: ${title} (-${cost}pts)`;

      // One read-modify-write attempt, followed by a post-write verification
      // read. PocketBase has no conditional update, so two concurrent redeems
      // by the same member can both pass the balance guard and clobber one
      // deduction. Mirrors the claim route's lost-update re-read: re-read the
      // week row and confirm OUR transaction landed; if not, report `conflict`
      // (the caller retries once).
      const attemptRedeem = async () => {
        const weekRecords = await pb.collection("week_data").getFullList({ requestKey: null });
        const week = weekRecords.find((r: any) => r.weekStart === currentWeek) || null;

        const points = parseJSON<Record<string, number>>(week?.points, {});
        const history = parseJSON<Transaction[]>(week?.history, []);

        const nowMs = Date.now();
        const dupe = history.find((tx) => {
          const at = Date.parse(tx.timestamp);
          return (
            tx.type === "redeem" &&
            tx.member === normalizedName &&
            Number(tx.amount) === -cost &&
            tx.description === description &&
            Number.isFinite(at) &&
            nowMs - at < REDEEM_DEDUPE_WINDOW_MS &&
            at <= nowMs
          );
        });
        if (dupe) {
          return { ok: false, reason: "duplicate" } as const;
        }

        const balance = points[normalizedName] || 0;
        if (balance < cost) {
          const firstName = normalizedName.split(" ")[0];
          const emoji = reward.emoji || "🎁";
          return {
            ok: false,
            reason: "insufficient",
            error: `${firstName} needs ${cost - balance} more pts for ${emoji} ${title}`,
          } as const;
        }

        const tx: Transaction = {
          id: nowMs + Math.floor(Math.random() * 1000),
          timestamp: new Date(nowMs).toISOString(),
          member: normalizedName,
          type: "redeem",
          amount: -cost,
          description,
        };

        const updatedWeek: WeekData = {
          weekStart: currentWeek,
          points: { ...points, [normalizedName]: balance - cost },
          streak: parseJSON<Record<string, number>>(week?.streak, {}),
          lastActive: parseJSON<Record<string, string>>(week?.lastActive, {}),
          history: [...history, tx],
        };

        if (week) {
          await pb.collection("week_data").update(week.id, updatedWeek);
        } else {
          await pb.collection("week_data").create(updatedWeek);
        }

        const verifyRow: any = week
          ? await pb.collection("week_data").getOne(week.id, { requestKey: null })
          : (await pb.collection("week_data").getFullList({ requestKey: null })).find(
              (r: any) => r.weekStart === currentWeek
            );
        const verifiedHistory = parseJSON<Transaction[]>(verifyRow?.history, []);
        if (!verifiedHistory.some((t) => t.id === tx.id)) {
          return {
            ok: false,
            reason: "conflict",
            error: "That reward couldn't be saved — the points changed at the same time. Please try again.",
          } as const;
        }

        return { ok: true, weekData: updatedWeek } as const;
      };

      // Retry the read-modify-write ONCE when a concurrent write clobbered it.
      let outcome = await attemptRedeem();
      if (!outcome.ok && outcome.reason === "conflict") {
        outcome = await attemptRedeem();
      }
      return outcome;
    });

    if (!result.ok) {
      const status = result.reason === "unknown-reward" ? 404 : result.reason === "insufficient" ? 400 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: (result as any).error },
        { status }
      );
    }

    return NextResponse.json({ ok: true, weekData: result.weekData });
  } catch (error) {
    console.error("Reward redeem API error:", error);
    return NextResponse.json({ error: "Failed to redeem reward" }, { status: 500 });
  }
}

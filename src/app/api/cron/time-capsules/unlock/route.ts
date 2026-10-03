import { NextRequest, NextResponse } from "next/server";
import { checkAndUnlockCapsules } from "@/lib/time-capsule";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cron/time-capsules/unlock — the host-crontab trigger that opens
 * time capsules whose `unlockDate` has passed.
 *
 * `checkAndUnlockCapsules` shipped with NO caller: no cron route, no crontab
 * line, no read path. A parent who wrote a time-locked capsule therefore saw
 * `contents: []` forever, on the unlock date and every day after it — a dead
 * feature with no error anywhere.
 *
 * This is the BELT. The braces are the sweep on the read path
 * (`GET /api/time-capsules` and `GET /api/time-capsules/[id]` both call it), so a
 * capsule opens on its day whether or not ops has installed the NAS crontab line.
 * Do not delete the read-path sweep because this route exists.
 *
 * Cadence matches the shape of the work: hourly. Unlocking is a `status` flip on
 * rows whose date has passed, so a finer cadence buys nothing, and the sweep only
 * ever moves capsules whose unlock date is ALREADY past — it can never open one
 * early.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const unlockedCount = await checkAndUnlockCapsules();
    return NextResponse.json({
      ok: true,
      unlockedCount,
      message: `Unlocked ${unlockedCount} time capsule${unlockedCount !== 1 ? "s" : ""}`,
    });
  } catch (err) {
    // An unreadable sweep is not a successful sweep with a zero count — say so.
    // (The lib itself swallows PB errors into 0; this catches the rest.)
    console.warn(
      "[time-capsules] unlock sweep failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ ok: false, reason: "unlock_error", unlockedCount: 0 });
  }
}
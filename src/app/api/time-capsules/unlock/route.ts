import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { checkAndUnlockCapsules } from '@/lib/time-capsule';

/**
 * POST /api/time-capsules/unlock
 * Check and unlock capsules that are ready to be opened.
 *
 * ON-SWEEP INVOCATION (2026-10-03). This route existed with a body but no
 * caller and no auth — its own comment said "should be called periodically (e.g.
 * daily via cron job)". It is now invoked on the sweep, but it is NOT how
 * capsules unlock any more; see the two callers that are:
 *
 *   - `GET /api/time-capsules` and `GET /api/time-capsules/[id]` sweep on the
 *     READ path, so a capsule opens on its date whether or not ops installed a
 *     host crontab line (the braces);
 *   - `POST /api/cron/time-capsules/unlock` is the belt, bearer-gated by
 *     `CRON_SECRET` like every other host-crontab route.
 *
 * That second route is where a server-driven cadence belongs. This one is a
 * signed-in-member trigger, so it takes the same session every sibling verb
 * takes rather than staying open to an unauthenticated caller — previously
 * ANYONE who could reach the app could fire the sweep.
 *
 * Prefer the cron route for automation; call this only when you deliberately
 * want a signed-in read to force the sweep immediately.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const unlockedCount = await checkAndUnlockCapsules();

    return NextResponse.json({
      success: true,
      unlockedCount,
      message: `Unlocked ${unlockedCount} time capsule${unlockedCount !== 1 ? 's' : ''}`,
    });
  } catch (error) {
    console.error('Failed to check and unlock capsules:', error);
    return NextResponse.json(
      { error: 'Failed to check and unlock capsules' },
      { status: 500 }
    );
  }
}
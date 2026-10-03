import { isLegacyOwner, requireSession, sanitizeUserId } from '@/lib/auth';
import { getLiveMemberById } from '@/lib/live-member';
import { NextRequest, NextResponse } from 'next/server';
import { getCapsule, markCapsuleViewed } from '@/lib/time-capsule';

/**
 * POST /api/time-capsules/[id]/view
 * Mark a capsule as viewed by the current user.
 *
 * This route used to resolve a session, take the caller's name and write
 * `viewedBy` + `firstViewedAt` with NO ownership check at all — while every
 * sibling verb has one (PATCH/DELETE require `createdBy`; the content POST
 * requires creator/recipient/family-wide). Any signed-in member could therefore
 * stamp "opened" permanently onto a parent's private capsule.
 *
 * The rule is now the same visibility rule `GET /api/time-capsules/[id]` uses,
 * because "mark as viewed" IS a visibility verb: the creator, a named recipient,
 * or anyone when the capsule is family-wide. A legacy `demo-user` creator stays
 * reachable (F8a continuity), matching the sibling routes.
 *
 * IDENTITY: the caller is resolved from the LIVE PocketBase member row, not the
 * session cookie's own claim (the house rule for privileged routes — "a cookie
 * role is never trusted; PB identity outage fails closed"). A session whose
 * member has been deleted is 401 `member_missing`; a PocketBase outage is 503
 * `member_lookup_failed` and writes nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: capsuleId } = await params;
    const session = await requireSession(request);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Live identity. Fails closed rather than trusting the cookie's name.
    let callerName: string;
    try {
      const member = await getLiveMemberById(session.memberId);
      if (!member) {
        return NextResponse.json({ error: 'member_missing' }, { status: 401 });
      }
      callerName = sanitizeUserId(member.name);
    } catch {
      return NextResponse.json({ error: 'member_lookup_failed' }, { status: 503 });
    }

    const existing = await getCapsule(capsuleId);
    if (!existing) {
      return NextResponse.json({ error: 'capsule_not_found' }, { status: 404 });
    }

    const { capsule } = existing;
    const owns = (ownerId: string | null | undefined) =>
      ownerId === callerName || isLegacyOwner(ownerId);
    const canView =
      owns(capsule.createdBy) || capsule.recipients.some(owns) || capsule.isFamilyWide === true;

    if (!canView) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    await markCapsuleViewed(capsuleId, callerName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to mark capsule as viewed:', error);
    return NextResponse.json(
      { error: 'Failed to mark capsule as viewed' },
      { status: 500 }
    );
  }
}
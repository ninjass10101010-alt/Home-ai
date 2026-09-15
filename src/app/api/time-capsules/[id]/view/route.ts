import { getUserId, requireSession } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { markCapsuleViewed } from '@/lib/time-capsule';

/**
 * POST /api/time-capsules/[id]/view
 * Mark a capsule as viewed by the current user.
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
    const userId = await getUserId(request);
    await markCapsuleViewed(capsuleId, userId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to mark capsule as viewed:', error);
    return NextResponse.json(
      { error: 'Failed to mark capsule as viewed' },
      { status: 500 }
    );
  }
}

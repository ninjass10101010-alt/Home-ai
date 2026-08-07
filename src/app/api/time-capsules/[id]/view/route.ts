import { getUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { markCapsuleViewed } from '@/lib/time-capsule';

/**
 * POST /api/time-capsules/[id]/view
 * Mark a capsule as viewed by the current user.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    const capsuleId = params.id;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
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

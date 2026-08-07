import { getUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { unlockBranch } from '@/lib/skill-tree';

/**
 * POST /api/skill-tree/branches/[id]/unlock
 * Unlock a skill branch (requires meeting level/XP/prerequisite requirements).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }
    
    const success = await unlockBranch(params.id, userId);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Cannot unlock branch. Check level, XP, and prerequisites.' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to unlock branch:', error);
    return NextResponse.json(
      { error: 'Failed to unlock branch' },
      { status: 500 }
    );
  }
}

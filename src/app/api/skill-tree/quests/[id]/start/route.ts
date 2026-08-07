import { getUserId } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { startQuest } from '@/lib/skill-tree';

/**
 * POST /api/skill-tree/quests/[id]/start
 * Start a quest (mark as active).
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
    
    const success = await startQuest(params.id, userId);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to start quest or quest already active' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to start quest:', error);
    return NextResponse.json(
      { error: 'Failed to start quest' },
      { status: 500 }
    );
  }
}

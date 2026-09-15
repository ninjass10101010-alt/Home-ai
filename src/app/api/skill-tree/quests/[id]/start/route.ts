import { getUserId, requireSession } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { startQuest } from '@/lib/skill-tree';

/**
 * POST /api/skill-tree/quests/[id]/start
 * Start a quest (mark as active).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: questId } = await params;
    const session = await requireSession(request);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = await getUserId(request);
    const success = await startQuest(questId, userId);
    
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

import { getUserId, requireSession } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { completeQuest } from '@/lib/skill-tree';

/**
 * POST /api/skill-tree/quests/[id]/complete
 * Complete a quest and earn XP.
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
    // Get proof from request body (optional)
    let proof = '';
    try {
      const body = await request.json();
      proof = body.proof || '';
    } catch {
      // No body provided, that's OK
    }

    const result = await completeQuest(questId, userId, proof);
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to complete quest. It may not be repeatable or already completed.' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      xpEarned: result.xpEarned,
      newLevel: result.newLevel,
      leveledUp: result.leveledUp,
    });
  } catch (error) {
    console.error('Failed to complete quest:', error);
    return NextResponse.json(
      { error: 'Failed to complete quest' },
      { status: 500 }
    );
  }
}

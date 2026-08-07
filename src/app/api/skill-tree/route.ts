import { NextRequest, NextResponse } from 'next/server';
import { getSkillTreeVisualization } from '@/lib/skill-tree';
import { getUserId, unauthorizedResponse } from '@/lib/auth';

/**
 * GET /api/skill-tree
 * Get complete skill tree visualization data for a user.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return unauthorizedResponse();
    }
    
    const data = await getSkillTreeVisualization(userId);
    
    if (!data) {
      return NextResponse.json(
        { error: 'Failed to load skill tree data' },
        { status: 500 }
      );
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to get skill tree:', error);
    return NextResponse.json(
      { error: 'Failed to get skill tree' },
      { status: 500 }
    );
  }
}

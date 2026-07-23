/**
 * GET /api/consuela/suggestions
 * Get proactive suggestions from Consuela AI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request) || 'demo-user';

    // TODO: Query proactive_suggestions collection for pending suggestions
    // For now, return empty array
    
    return NextResponse.json({
      success: true,
      suggestions: [],
      userId,
    });
  } catch (error: any) {
    console.error('Suggestions error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get suggestions', suggestions: [] },
      { status: 500 }
    );
  }
}

/**
 * POST /api/consuela/suggestions
 * Create or update a proactive suggestion
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserId(request) || 'demo-user';
    const body = await request.json();

    const { title, message, triggerType, priority = 'medium', actions = [] } = body;

    if (!title || !message || !triggerType) {
      return NextResponse.json(
        { error: 'Title, message, and triggerType are required' },
        { status: 400 }
      );
    }

    // TODO: Create suggestion in proactive_suggestions collection
    
    return NextResponse.json({
      success: true,
      suggestion: {
        id: 'temp-id',
        userId,
        title,
        message,
        triggerType,
        priority,
        actions,
        status: 'pending',
        shownAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Create suggestion error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create suggestion' },
      { status: 500 }
    );
  }
}

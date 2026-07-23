import { NextRequest, NextResponse } from 'next/server';
import { getUserMountains, createMountain } from '@/lib/money-mountain';
import { getUserId, unauthorizedResponse } from '@/lib/auth';

/**
 * GET /api/money-mountain
 * Get all mountains for the current user.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return unauthorizedResponse();
    }
    
    const mountains = await getUserMountains(userId);
    
    return NextResponse.json({ mountains });
  } catch (error) {
    console.error('Failed to get mountains:', error);
    return NextResponse.json(
      { error: 'Failed to get mountains' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/money-mountain
 * Create a new savings goal (mountain).
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return unauthorizedResponse();
    }
    
    const data = await request.json();
    
    // Validation
    if (!data.name || !data.targetAmount) {
      return NextResponse.json(
        { error: 'Name and target amount are required' },
        { status: 400 }
      );
    }
    
    if (data.targetAmount <= 0) {
      return NextResponse.json(
        { error: 'Target amount must be greater than 0' },
        { status: 400 }
      );
    }
    
    const mountain = await createMountain(userId, data);
    
    if (!mountain) {
      return NextResponse.json(
        { error: 'Failed to create mountain' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ mountain }, { status: 201 });
  } catch (error) {
    console.error('Failed to create mountain:', error);
    return NextResponse.json(
      { error: 'Failed to create mountain' },
      { status: 500 }
    );
  }
}

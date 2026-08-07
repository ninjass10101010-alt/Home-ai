import { NextRequest, NextResponse } from 'next/server';
import { getUserCapsules, createCapsule, checkAndUnlockCapsules } from '@/lib/time-capsule';
import type { CreateCapsuleRequest } from '@/db/features/time-capsule';
import { getUserId, unauthorizedResponse } from '@/lib/auth';

/**
 * GET /api/time-capsules
 * Get all time capsules for the current user.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return unauthorizedResponse();
    }
    
    const capsules = await getUserCapsules(userId);
    
    return NextResponse.json({ capsules });
  } catch (error) {
    console.error('Failed to get time capsules:', error);
    return NextResponse.json(
      { error: 'Failed to get time capsules' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/time-capsules
 * Create a new time capsule.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserId(request);
    
    if (!userId) {
      return unauthorizedResponse();
    }
    
    const data: CreateCapsuleRequest = await request.json();
    
    // Validation
    if (!data.title || !data.unlockDate) {
      return NextResponse.json(
        { error: 'Title and unlock date are required' },
        { status: 400 }
      );
    }
    
    // Check if unlock date is in the future
    const unlockDate = new Date(data.unlockDate);
    if (unlockDate <= new Date()) {
      return NextResponse.json(
        { error: 'Unlock date must be in the future' },
        { status: 400 }
      );
    }
    
    const capsule = await createCapsule(userId, data);
    
    if (!capsule) {
      return NextResponse.json(
        { error: 'Failed to create time capsule' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ capsule }, { status: 201 });
  } catch (error) {
    console.error('Failed to create time capsule:', error);
    return NextResponse.json(
      { error: 'Failed to create time capsule' },
      { status: 500 }
    );
  }
}

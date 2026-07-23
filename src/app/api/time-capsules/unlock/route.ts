import { NextRequest, NextResponse } from 'next/server';
import { checkAndUnlockCapsules } from '@/lib/time-capsule';

/**
 * POST /api/time-capsules/unlock
 * Check and unlock capsules that are ready to be opened.
 * This should be called periodically (e.g., daily via cron job).
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication/authorization here
    // This endpoint should be protected in production
    
    const unlockedCount = await checkAndUnlockCapsules();
    
    return NextResponse.json({
      success: true,
      unlockedCount,
      message: `Unlocked ${unlockedCount} time capsule${unlockedCount !== 1 ? 's' : ''}`,
    });
  } catch (error) {
    console.error('Failed to check and unlock capsules:', error);
    return NextResponse.json(
      { error: 'Failed to check and unlock capsules' },
      { status: 500 }
    );
  }
}
